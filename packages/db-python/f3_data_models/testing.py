from datetime import date

from sqlalchemy import or_

from f3_data_models.models import Event, Org
from f3_data_models.utils import DbManager


def test():
    org_id = 25272
    event_records = DbManager.find_records(
        Event,
        filters=[
            Event.is_active,
            or_(Event.org_id == org_id, Event.org.has(Org.parent_id == org_id)),
            or_(Event.end_date >= date.today(), Event.end_date.is_(None)),
        ],
        joinedloads="all",
    )
    print(f"Found {len(event_records)} active events for org_id {org_id}.")


if __name__ == "__main__":
    test()
