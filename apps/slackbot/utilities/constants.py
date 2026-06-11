import os

import dotenv

dotenv.load_dotenv()

SLACK_BOT_TOKEN = "SLACK_BOT_TOKEN"
SLACK_STATE_S3_BUCKET_NAME = "ENV_SLACK_STATE_S3_BUCKET_NAME"
SLACK_INSTALLATION_S3_BUCKET_NAME = "ENV_SLACK_INSTALLATION_S3_BUCKET_NAME"
SLACK_CLIENT_ID = "ENV_SLACK_CLIENT_ID"
SLACK_CLIENT_SECRET = "ENV_SLACK_CLIENT_SECRET"
SLACK_SCOPES = "ENV_SLACK_SCOPES"
PASSWORD_ENCRYPT_KEY = "PASSWORD_ENCRYPT_KEY"
APP_URL = "APP_URL"

DATABASE_HOST = "DATABASE_HOST"
ADMIN_DATABASE_USER = "ADMIN_DATABASE_USER"
ADMIN_DATABASE_PASSWORD = "ADMIN_DATABASE_PASSWORD"
ADMIN_DATABASE_SCHEMA = "ADMIN_DATABASE_SCHEMA"
PAXMINER_DATABASE_HOST = "PAXMINER_DATABASE_HOST"
PAXMINER_DATABASE_USER = "PAXMINER_DATABASE_USER"
PAXMINER_DATABASE_PASSWORD = "PAXMINER_DATABASE_PASSWORD"
PAXMINER_DATABASE_SCHEMA = "PAXMINER_DATABASE_SCHEMA"
STRAVA_CLIENT_ID = "STRAVA_CLIENT_ID"
STRAVA_CLIENT_SECRET = "STRAVA_CLIENT_SECRET"
LOW_REZ_IMAGE_SIZE = 1000

LOCAL_DEVELOPMENT = os.environ.get("LOCAL_DEVELOPMENT", "").lower() in ("1", "true", "yes")
SOCKET_MODE = os.environ.get("SOCKET_MODE", "").lower() in ("1", "true", "yes")
ENABLE_DEBUGGING = os.environ.get("ENABLE_DEBUGGING", "false").lower() == "true"
ALL_USERS_ARE_ADMINS = os.environ.get("ALL_USERS_ARE_ADMINS", "false").lower() == "true"
FILE_BUCKET_PREFIX = os.environ.get("FILE_BUCKET_PREFIX", "f3nation")

SLACK_STATE_S3_BUCKET_NAME = "ENV_SLACK_STATE_S3_BUCKET_NAME"
SLACK_INSTALLATION_S3_BUCKET_NAME = "ENV_SLACK_INSTALLATION_S3_BUCKET_NAME"
SLACK_CLIENT_ID = "ENV_SLACK_CLIENT_ID"
SLACK_CLIENT_SECRET = "ENV_SLACK_CLIENT_SECRET"
SLACK_SCOPES = "ENV_SLACK_SCOPES"

CONFIG_DESTINATION_AO = {"name": "The AO Channel", "value": "ao_channel"}
CONFIG_DESTINATION_CURRENT = {"name": "Current Channel", "value": "current_channel"}
CONFIG_DESTINATION_SPECIFIED = {"name": "Specified Channel:", "value": "specified_channel"}

DEFAULT_BACKBLAST_MOLESKINE_TEMPLATE = {
    "type": "rich_text",
    "elements": [
        {
            "type": "rich_text_section",
            "elements": [
                {
                    "type": "text",
                    "text": "\nWARMUP:",
                    "style": {"bold": True},
                },
                {
                    "type": "text",
                    "text": " \n",
                },
                {
                    "type": "text",
                    "text": "THE THANG:",
                    "style": {"bold": True},
                },
                {
                    "type": "text",
                    "text": " \n",
                },
                {
                    "type": "text",
                    "text": "MARY:",
                    "style": {"bold": True},
                },
                {
                    "type": "text",
                    "text": " \n",
                },
                {
                    "type": "text",
                    "text": "ANNOUNCEMENTS:",
                    "style": {"bold": True},
                },
                {
                    "type": "text",
                    "text": " \n",
                },
                {
                    "type": "text",
                    "text": "COT:",
                    "style": {"bold": True},
                },
                {
                    "type": "text",
                    "text": " ",
                },
            ],
        }
    ],
}

DEFAULT_PREBLAST_MOLESKINE_TEMPLATE = {
    "type": "rich_text",
    "elements": [
        {
            "type": "rich_text_section",
            "elements": [
                {
                    "type": "text",
                    "text": "\nWHAT:",
                    "style": {"bold": True},
                },
                {
                    "type": "text",
                    "text": " \n",
                },
                {
                    "type": "text",
                    "text": "WHY: ",
                    "style": {"bold": True},
                },
                {
                    "type": "text",
                    "text": " ",
                },
            ],
        }
    ],
}

STATE_METADATA = "STATE_METADATA"

HC_STANDARD_RESPONSE = "{user} has HC'd!"
UNHC_STANDARD_RESPONSE = "{user} has Un-HC'd"

HC_SNARKY_RESPONSES = [
    "{user} has HC'd and is locked and loaded!",
    "{user} just HC'd. The PAX just got better looking.",
    "Oh snap, {user} just dropped an HC! Better stretch now.",
    "{user} is IN. The gloom shall not be denied.",
    "Lock it up boys, {user} just HC'd. No backing out now!",
    "The legend himself, {user}, has HC'd. Shield your eyes.",
    "{user} just HC'd. Moleskin not required, courage is.",
    "HC ALERT: {user} is coming out to play. Hide your weinke.",
    "{user} has committed. The Q weeps tears of joy.",
    "Someone tell the Q — {user} just HC'd and they mean business.",
    "{user} just HC'd. The excuses stop here.",
    "An HC from {user}? The mumblechatter is going to be epic.",
    "{user} is in. Cancel the search party.",
    "HC confirmed for {user}. The fartsack has been defeated.",
    "Warning: {user} has HC'd. Expect heavy breathing and questionable form.",
    "{user} just HC'd. Bring your own coupon.",
    "The gloom beckons, and {user} answered the call. HC logged.",
    "Prepare the blacktop, {user} has officially HC'd.",
    "That’s an HC from {user}. See you in the gloom, brother.",
    "{user} just dropped an HC. Let the beatdown commence.",
    "Lock the gates! {user} has HC'd and is ready for the pain.",
    "{user} just HC'd. Time to double check the weinke.",
    "Boom! {user} is on the board. The PAX grows stronger.",
    "{user} HC'd. Get that man a coffee... after the COT.",
    "The EH worked! {user} just HC'd.",
]

UNHC_SNARKY_RESPONSES = [
    "What?!? {user} has Un-HC'd. Guess they don't like you guys.",
    "{user} just Un-HC'd. The Q is not crying, you're crying.",
    "Breaking news: {user} has abandoned the PAX. Stay strong, men.",
    "{user} Un-HC'd. The weinke has been updated accordingly. :cry:",
    "Another one bites the dust. {user} is out. #EH them again.",
    "{user} Un-HC'd. Their parking spot has been reassigned.",
    "Thoughts and prayers for the Q — {user} just Un-HC'd.",
    "{user} has Un-HC'd. The downrange spirit is shaken but not stirred.",
    "Well well well, {user} Un-HC'd. The coffeeteria has been notified.",
    "{user} just Un-HC'd. The gloom misses them already.",
    "Oof. {user} just un-HC'd. The fartsack claims another victim.",
    "Sad clown alert! {user} has un-HC'd.",
    "{user} just un-HC'd. Someone check on their M, they might have chores.",
    "Un-HC from {user}. We’ll do an extra burpee in their honor.",
    "Alert the EH committee, {user} just un-HC'd.",
    "{user} un-HC'd. The gloom will have to wait.",
    "Looks like {user} hit snooze. Un-HC recorded.",
    "{user} just un-HC'd. Guess those coupons were too heavy.",
    "Tragic news: {user} un-HC'd. More respect for the rest of us.",
    "{user} un-HC'd. Keep them in your thoughts during the plank jacks.",
    "Well, this is awkward. {user} just un-HC'd.",
    "{user} backed out. Cue the tiny violin.",
    "Un-HC detected from {user}. The Q will remember this.",
    "{user} has left the chat (and the beatdown).",
    "Someone tag {user} tomorrow morning. The un-HC stings.",
]

AWS_ACCESS_KEY_ID = "AWS_ACCESS_KEY_ID"
AWS_SECRET_ACCESS_KEY = "AWS_SECRET_ACCESS_KEY"

WELCOME_MESSAGE_SUFFIX = " Welcome to {region}! We're glad you're here. Please take a moment to introduce yourself and let us know how we can help you get started. We're looking forward to seeing you in the gloom!"  # noqa: E501

WELCOME_MESSAGE_TEMPLATES = [
    "The man, the myth, the LEGEND, it's {user}!" + WELCOME_MESSAGE_SUFFIX,
    "Who's this?!? It's {user}!" + WELCOME_MESSAGE_SUFFIX,
    "Hey, it's {user}!" + WELCOME_MESSAGE_SUFFIX,
    "Sharkbait, ooh ha ha! It's {user}!" + WELCOME_MESSAGE_SUFFIX,
    "Could it be?!? It's {user}!" + WELCOME_MESSAGE_SUFFIX,
    "{user} is in the house!" + WELCOME_MESSAGE_SUFFIX,
    "Hold the phone, {user} just joined!" + WELCOME_MESSAGE_SUFFIX,
    "A wild {user} appears!" + WELCOME_MESSAGE_SUFFIX,
    "The fartsack is officially on notice. {user} has arrived!" + WELCOME_MESSAGE_SUFFIX,
    "Alert the Qs, {user} is on the roster!" + WELCOME_MESSAGE_SUFFIX,
    "Look who decided to step out of the sad clown car! It's {user}!" + WELCOME_MESSAGE_SUFFIX,
    "Drop your coupons and welcome {user}!" + WELCOME_MESSAGE_SUFFIX,
    "New blood in the brotherhood! Give it up for {user}!" + WELCOME_MESSAGE_SUFFIX,
]

MAX_HEIC_SIZE = 1000

ERROR_FORM_MESSAGE_TEMPLATE = ":warning: Sorry, the following error occurred:\n\n```{error}```"

PAXMINER_REPORT_DICT = {
    "send_pax_charts": "pax_charts",
    "send_ao_leaderboard": "ao_leaderboard",
    "send_q_charts": "q_charts",
    "send_region_leaderboard": "region_leaderboard",
    "send_region_stats": "region_stats",
}

FREQUENCY_OPTIONS = {
    "names": ["Week", "Month"],
    "values": ["Weekly", "Monthly"],
}
INTERVAL_OPTIONS = {
    "names": ["Every", "Every Other", "Every Third", "Every Fourth", "Every Fifth"],
    "values": ["1", "2", "3", "4", "5"],
}
WEEK_INDEX_OPTIONS = {
    "names": ["1st", "2nd", "3rd", "4th", "5th", "Last"],
    "values": ["1", "2", "3", "4", "5", "0"],
}

ORG_TYPES = {
    "AO": 1,
    "Region": 2,
    "Area": 3,
    "Sector": 4,
}

S3_IMAGE_URL = "https://slackblast-images.s3.amazonaws.com/{image_name}"
GCP_IMAGE_URL = "https://storage.googleapis.com/{bucket}/{image_name}"

# Define colors for event tags
# first is background color, second is text color
EVENT_TAG_COLORS = {
    "Closed": ("#404040", "#888888"),  # Dark gray with muted text for closed events
    "Red": ("#FF0000", "#FFFFFF"),
    "Orange": ("#FFA500", "#FFFFFF"),
    "Yellow": ("#FFFF00", "#000000"),
    "Green": ("#008000", "#FFFFFF"),
    "Blue": ("#0000FF", "#FFFFFF"),
    "Purple": ("#800080", "#FFFFFF"),
    "Pink": ("#FFC0CB", "#000000"),
    "Black": ("#000000", "#FFFFFF"),
    "White": ("#FFFFFF", "#000000"),
    "Gray": ("#808080", "#FFFFFF"),
    "Brown": ("#A52A2A", "#FFFFFF"),
    "Cyan": ("#00FFFF", "#000000"),
    "Magenta": ("#FF00FF", "#000000"),
    "Lime": ("#00FF00", "#000000"),
    "Teal": ("#008080", "#FFFFFF"),
    "Indigo": ("#4B0082", "#FFFFFF"),
    "Maroon": ("#800000", "#FFFFFF"),
    "Navy": ("#000080", "#FFFFFF"),
    "Olive": ("#808000", "#FFFFFF"),
    "Silver": ("#C0C0C0", "#000000"),
    "Sky": ("#87CEEB", "#000000"),
    "Gold": ("#FFD700", "#000000"),
    "Coral": ("#FF7F50", "#000000"),
    "Salmon": ("#FA8072", "#000000"),
    "Turquoise": ("#40E0D0", "#000000"),
    "Lavender": ("#E6E6FA", "#000000"),
    "Beige": ("#F5F5DC", "#000000"),
    "Mint": ("#98FF98", "#000000"),
    "Peach": ("#FFDAB9", "#000000"),
}

ALL_PERMISSIONS = "All"
PERMISSIONS = {
    ALL_PERMISSIONS: "All",
}

ACHIEVEMENTS_ALPHA_TESTING_ORG_IDS = [
    int(org_id) for org_id in os.environ.get("ACHIEVEMENTS_ALPHA_TESTING_ORG_IDS", "").split(",") if org_id
]
ACHIEVEMENT_AWARD_HOUR_CST = int(os.environ.get("ACHIEVEMENT_AWARD_HOUR_CST", 9))
