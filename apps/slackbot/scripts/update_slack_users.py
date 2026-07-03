import os
import sys

from sqlalchemy import case, select, update

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from f3_data_models.models import Attendance, EventInstance, Org, Org_x_SlackSpace, SlackSpace, SlackUser, User
from f3_data_models.utils import DbManager, get_session
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

from utilities.helper_functions import create_user, safe_get


def update_slack_users(force=False):
    """
    Update Slack users in the database with their latest information from Slack.
    """
    all_slack_users = DbManager.find_records(cls=SlackUser, filters=[True])
    slack_user_dict = {user.slack_id: user for user in all_slack_users}
    all_slack_spaces: list[tuple[SlackSpace, Org_x_SlackSpace]] = DbManager.find_join_records2(
        SlackSpace,
        Org_x_SlackSpace,
        filters=[True],
    )

    for slack_space_record in all_slack_spaces:
        slack_space = slack_space_record[0]
        region_org_record = slack_space_record[1]
        client = WebClient(token=slack_space.settings.get("bot_token"))
        try:
            users: list[dict] = []

            response = client.users_list()
            users = response["members"]
            while response.get("response_metadata", {}).get("next_cursor"):
                response = client.users_list(cursor=response["response_metadata"]["next_cursor"])
                users.extend(response["members"])

            for user in users:
                if user["is_bot"] or user["id"] == "USLACKBOT":
                    continue  # Skip bots and the Slackbot

                slack_user = slack_user_dict.get(user["id"])
                if not safe_get(slack_user, "user_id"):
                    print(f"Creating new Slack user {user['id']} ({user.get('name')})")
                    slack_user = create_user(user, region_org_record.org_id)
                elif slack_user.slack_updated and slack_user.slack_updated >= user["updated"] and not force:
                    continue
                else:
                    update_fields = {
                        SlackUser.user_name: safe_get(user, "profile", "display_name")
                        or safe_get(user, "profile", "real_name")
                        or safe_get(user, "name"),
                        SlackUser.slack_updated: safe_get(user, "updated"),
                        SlackUser.is_admin: safe_get(user, "is_admin") or False,
                        SlackUser.is_owner: safe_get(user, "is_owner") or False,
                        SlackUser.is_bot: safe_get(user, "is_bot") or False,
                        SlackUser.avatar_url: safe_get(user, "profile", "image_512"),
                    }
                    DbManager.update_record(SlackUser, slack_user.id, update_fields)

            print("Slack users updated successfully.")

        except SlackApiError as e:
            print(f"Error updating Slack users for {slack_space.workspace_name}: {e.response['error']}")
            continue


def update_home_regions():
    users_without_home_region = DbManager.find_records(cls=User, filters=[User.home_region_id.is_(None)])
    print(f"Found {len(users_without_home_region)} users without home region.")
    # option 1: find the first event they attended and set that region as their home region
    # option 2: find the org_id from their slack user associations
    if users_without_home_region:
        with get_session() as session:
            first_event_subquery = (
                select(
                    case(
                        (Org.org_type == "region", Org.id),
                        else_=Org.parent_id,
                    ).label("region_id")
                )
                .select_from(EventInstance)
                .join(Attendance, Attendance.event_instance_id == EventInstance.id)
                .join(Org, Org.id == EventInstance.org_id)
                .filter(Attendance.user_id == User.id)
                .order_by(EventInstance.start_date, EventInstance.start_time)
                .limit(1)
                .correlate(User)
            )

            slack_space_subquery = (
                select(Org_x_SlackSpace.org_id)
                .join(SlackSpace, SlackSpace.id == Org_x_SlackSpace.slack_space_id)
                .join(SlackUser, SlackUser.slack_team_id == SlackSpace.team_id)
                .filter(SlackUser.user_id == User.id)
                .limit(1)
                .correlate(User)
            )

            update_query = (
                update(User)
                .where(User.id.in_([user.id for user in users_without_home_region]))
                .values(
                    {
                        User.home_region_id: case(
                            (first_event_subquery.exists(), first_event_subquery.scalar_subquery()),
                            (slack_space_subquery.exists(), slack_space_subquery.scalar_subquery()),
                            else_=User.home_region_id,
                        )
                    }
                )
            )
            session.execute(update_query)
            session.commit()


if __name__ == "__main__":
    update_slack_users()
    update_home_regions()
