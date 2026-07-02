from utilities import constants
from utilities.slack import actions, orm

UNSCHEDULED_BACKBLAST_BLOCKS = [
    orm.InputBlock(
        label="Workout Date",
        action=actions.BACKBLAST_DATE,
        optional=False,
        element=orm.DatepickerElement(placeholder="Select the date..."),
    ),
    orm.InputBlock(
        label="Event Type",
        action=actions.BACKBLAST_EVENT_TYPE,
        optional=False,
        element=orm.StaticSelectElement(placeholder="Select the event type..."),
    ),
    orm.InputBlock(
        label="Location",
        action=actions.BACKBLAST_LOCATION,
        optional=True,
        element=orm.StaticSelectElement(placeholder="Select the location..."),
    ),
    orm.InputBlock(
        label="The AO",
        action=actions.BACKBLAST_AO,
        optional=False,
        element=orm.StaticSelectElement(placeholder="Select the AO..."),
    ),
]

BACKBLAST_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Title",
            action=actions.BACKBLAST_TITLE,
            optional=False,
            element=orm.PlainTextInputElement(placeholder="Enter a workout title..."),
        ),
        orm.InputBlock(
            label="Upload a boyband",
            element=orm.FileInputElement(
                max_files=1,
                filetypes=[
                    "png",
                    "jpg",
                    "heic",
                    "bmp",
                ],
            ),
            action=actions.BACKBLAST_FILE,
            optional=True,
        ),
        orm.SectionBlock(
            label="This is where the AO name, Event Types, and Workout Date will be filled in automatically.",
            action=actions.BACKBLAST_INFO,
        ),
        orm.InputBlock(
            label="The Q",
            action=actions.BACKBLAST_Q,
            optional=False,
            element=orm.UsersSelectElement(placeholder="Select the Q..."),
        ),
        orm.InputBlock(
            label="The CoQ(s), if any",
            action=actions.BACKBLAST_COQ,
            optional=True,
            element=orm.MultiUsersSelectElement(placeholder="Select the CoQ(s)..."),
        ),
        orm.InputBlock(
            label="The PAX",
            action=actions.BACKBLAST_PAX,
            optional=False,
            element=orm.MultiUsersSelectElement(placeholder="Select the PAX..."),
        ),
        orm.InputBlock(
            label="PAX not in this Slack space",
            action=actions.USER_OPTION_LOAD,
            optional=True,
            element=orm.MultiExternalSelectElement(placeholder="Type to search..."),
            hint="To filter by home region, include the region in parentheses after their name, e.g. 'money (wash)' -> Moneyball (WashMo).",  # noqa: E501
        ),
        orm.InputBlock(
            label="List untaggable PAX, separated by commas (not FNGs)",
            action=actions.BACKBLAST_NONSLACK_PAX,
            optional=True,
            element=orm.PlainTextInputElement(
                placeholder="Enter untaggable PAX...",
            ),
        ),
        orm.InputBlock(
            label="List FNGs, separated by commas",
            action=actions.BACKBLAST_FNGS,
            optional=True,
            element=orm.PlainTextInputElement(placeholder="Enter FNGs..."),
        ),
        orm.InputBlock(
            label="Total PAX Count",
            action=actions.BACKBLAST_COUNT,
            optional=True,
            element=orm.PlainTextInputElement(placeholder="Total PAX count including FNGs"),
            hint="If left blank, this will be calculated automatically from the fields above.",
        ),
        orm.InputBlock(
            label="The Moleskine",
            action=actions.BACKBLAST_MOLESKIN,
            optional=False,
            element=orm.RichTextInputElement(),
        ),
        orm.ContextBlock(
            element=orm.ContextElement(
                initial_value="*Note:* anything you put here may be visible to the public, through dashboards, websites, etc. We encourage you to post private COT items (prayer requests, etc) in a separate post or reply to the backblast.",  # noqa: E501
            ),
        ),
        orm.InputBlock(
            label="Backblast Options",
            action=actions.BACKBLAST_OPTIONS,
            optional=True,
            element=orm.CheckboxInputElement(
                options=orm.as_selector_options(
                    names=[
                        "Exclude stats from PAX Vault",
                    ],
                    values=[
                        "exclude_from_pax_vault",
                    ],
                )
            ),
        ),
        orm.DividerBlock(),
        # orm.InputBlock(
        #     label="Choose where to post this",
        #     action=actions.BACKBLAST_DESTINATION,
        #     optional=False,
        #     element=orm.StaticSelectElement(placeholder="Select a destination..."),
        # ),
        orm.InputBlock(
            label="Email Backblast (to Wordpress, etc)",
            action=actions.BACKBLAST_EMAIL_SEND,
            optional=False,
            element=orm.RadioButtonsElement(
                options=orm.as_selector_options(names=["Send Email", "Don't Send Email"], values=["yes", "no"]),
                initial_value="yes",
            ),
        ),
        orm.InputBlock(
            label="When to post backblast?",
            action=actions.BACKBLAST_SEND_OPTIONS,
            optional=False,
            element=orm.RadioButtonsElement(
                options=orm.as_selector_options(
                    names=["Send now", "Save and send later"],
                ),
                initial_value="Send now",
            ),
        ),
    ]
)

PREBLAST_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Title",
            action=actions.PREBLAST_TITLE,
            optional=False,
            element=orm.PlainTextInputElement(placeholder="Enter a workout title..."),
        ),
        orm.InputBlock(
            label="The AO",
            action=actions.PREBLAST_AO,
            optional=False,
            element=orm.ChannelsSelectElement(placeholder="Select the AO..."),
        ),
        orm.InputBlock(
            label="Workout Date",
            action=actions.PREBLAST_DATE,
            optional=False,
            element=orm.DatepickerElement(
                placeholder="Select the date...",
            ),
        ),
        orm.InputBlock(
            label="Workout Time",
            action=actions.PREBLAST_TIME,
            optional=False,
            element=orm.TimepickerElement(),
        ),
        orm.InputBlock(
            label="The Q",
            action=actions.PREBLAST_Q,
            optional=False,
            element=orm.UsersSelectElement(placeholder="Select the Q..."),
        ),
        orm.InputBlock(
            label="Coupons?",
            action=actions.PREBLAST_COUPONS,
            optional=True,
            element=orm.PlainTextInputElement(  # TODO: change to radio buttons or checkboxes
                placeholder="Coupons or not?",
            ),
        ),
        orm.InputBlock(
            label="Moleskine",
            action=actions.PREBLAST_MOLESKIN,
            optional=True,
            element=orm.RichTextInputElement(),
        ),
        orm.DividerBlock(),
        orm.InputBlock(
            label="Choose where to post this",
            action=actions.PREBLAST_DESTINATION,
            optional=False,
            element=orm.StaticSelectElement(placeholder="Select a destination..."),
        ),
    ]
)

CONFIG_FORM = orm.BlockView(
    [
        orm.ActionsBlock(
            elements=[
                orm.ButtonElement(
                    label=":date: Calendar Settings",
                    action=actions.CONFIG_CALENDAR,
                ),
                orm.ButtonElement(
                    label=":world_map: Region Info",
                    action=actions.REGION_INFO_BUTTON,
                ),
                orm.ButtonElement(
                    label=":bust_in_silhouette: User Settings",
                    action=actions.CONFIG_USER_SETTINGS,
                ),
                orm.ButtonElement(
                    label=":hospital: Emergency Info Access",
                    action=actions.CONFIG_EMERGENCY_INFO,
                ),
                orm.ButtonElement(
                    label=":grey_question: Help Menu",
                    action=actions.CONFIG_HELP_MENU,
                ),
                orm.ButtonElement(
                    label=":speech_balloon: Welcomebot Settings",
                    action=actions.CONFIG_WELCOME_MESSAGE,
                ),
                orm.ButtonElement(
                    label=":chart_with_upwards_trend: Reporting Settings",
                    action=actions.CONFIG_REPORTING,
                ),
                # orm.ButtonElement(
                #     label=":newspaper: Region Canvas Settings",
                #     action=actions.CONFIG_SPECIAL_EVENTS,
                # ),
                orm.ButtonElement(
                    label=":classical_building: SLT Settings",
                    action=actions.CONFIG_SLT,
                ),
                orm.ButtonElement(
                    label=":gear: Backblast & Preblast Settings",
                    action=actions.CONFIG_GENERAL,
                ),
                orm.ButtonElement(
                    label=":email: Backblast Email Settings",
                    action=actions.CONFIG_EMAIL,
                ),
                orm.ButtonElement(
                    label=":bar_chart: Custom Field Settings",
                    action=actions.CONFIG_CUSTOM_FIELDS,
                ),
                orm.ButtonElement(
                    label=":computer: Paxminer Mapping",
                    action=actions.PAXMINER_MAPPING,
                ),
                orm.ButtonElement(
                    label=":airplane: Downrange",
                    action=actions.CONFIG_DOWNRANGE,
                ),
            ],
        ),
    ]
)

ACHIEVEMENT_BUTTON = orm.ButtonElement(
    label=":sports_medal: Achievement Settings",
    action=actions.CONFIG_ACHIEVEMENTS,
)

CONFIG_NO_ORG_FORM = orm.BlockView(
    [
        orm.ActionsBlock(
            elements=[
                orm.ButtonElement(
                    label=":date: Migration Settings",
                    action=actions.CONFIG_CONNECT,
                ),
                orm.ButtonElement(
                    label=":bust_in_silhouette: User Settings",
                    action=actions.CONFIG_USER_SETTINGS,
                ),
                orm.ButtonElement(
                    label=":speech_balloon: Welcomebot Settings",
                    action=actions.CONFIG_WELCOME_MESSAGE,
                ),
                orm.ButtonElement(
                    label=":gear: Backblast & Preblast Settings",
                    action=actions.CONFIG_GENERAL,
                ),
                orm.ButtonElement(
                    label=":email: Backblast Email Settings",
                    action=actions.CONFIG_EMAIL,
                ),
                orm.ButtonElement(
                    label=":bar_chart: Custom Field Settings",
                    action=actions.CONFIG_CUSTOM_FIELDS,
                ),
            ],
        ),
    ]
)

CONFIG_EMAIL_FORM = orm.BlockView(
    [
        orm.InputBlock(
            label="Backblast Email",
            action=actions.CONFIG_EMAIL_ENABLE,
            optional=False,
            element=orm.RadioButtonsElement(
                initial_value="disable",
                options=orm.as_selector_options(names=["Enable Email", "Disable Email"], values=["enable", "disable"]),
            ),
        ),
        orm.InputBlock(
            label="Show email option in form?",
            action=actions.CONFIG_EMAIL_SHOW_OPTION,
            optional=False,
            element=orm.RadioButtonsElement(
                initial_value="no",
                options=orm.as_selector_options(names=["Show", "Don't Show"], values=["yes", "no"]),
            ),
        ),
        orm.InputBlock(
            label="Email Server",
            action=actions.CONFIG_EMAIL_SERVER,
            optional=False,
            element=orm.PlainTextInputElement(initial_value="smtp.gmail.com"),
        ),
        orm.InputBlock(
            label="Email Port",
            action=actions.CONFIG_EMAIL_PORT,
            optional=False,
            element=orm.PlainTextInputElement(initial_value="587"),
        ),
        orm.InputBlock(
            label="Email From Address",
            action=actions.CONFIG_EMAIL_FROM,
            optional=False,
            element=orm.PlainTextInputElement(initial_value="example_sender@gmail.com"),
        ),
        orm.InputBlock(
            label="Email Password",
            action=actions.CONFIG_EMAIL_PASSWORD,
            optional=False,
            element=orm.PlainTextInputElement(initial_value="example_pwd_123"),
            hint="If using gmail, you must use an App Password (https://support.google.com/accounts/answer/185833)."
            "Your password will be stored encrypted - however, it is STRONGLY recommended that you use a non-personal"
            "email address and password for this purpose, as security cannot be guaranteed.",
        ),
        orm.InputBlock(
            label="Email To Address",
            action=actions.CONFIG_EMAIL_TO,
            optional=False,
            element=orm.PlainTextInputElement(initial_value="example_destination@gmail.com"),
        ),
        orm.InputBlock(
            label="Use Postie formatting for categories?",
            action=actions.CONFIG_POSTIE_ENABLE,
            optional=False,
            element=orm.RadioButtonsElement(
                initial_value="no",
                options=orm.as_selector_options(names=["Yes", "No"], values=["yes", "no"]),
            ),
            hint="This will put the AO name as a category for the post, and will put PAX names at the end as tags.",
        ),
    ]
)

CONFIG_GENERAL_FORM = orm.BlockView(
    [
        orm.InputBlock(
            label="Enable Strava Integration?",
            action=actions.CONFIG_ENABLE_STRAVA,
            optional=False,
            element=orm.RadioButtonsElement(
                initial_value="no",
                options=orm.as_selector_options(names=["Enable", "Disable"], values=["enable", "disable"]),
            ),
        ),
        orm.DividerBlock(),
        orm.InputBlock(
            label="Lock editing of backblasts?",
            action=actions.CONFIG_EDITING_LOCKED,
            optional=False,
            element=orm.RadioButtonsElement(
                initial_value="no",
                options=orm.as_selector_options(names=["Yes", "No"], values=["yes", "no"]),
            ),
        ),
        orm.DividerBlock(),
        orm.InputBlock(
            label="Default Slack channel desination for preblasts",
            action=actions.CONFIG_DEFAULT_PREBLAST_DESTINATION,
            optional=False,
            element=orm.RadioButtonsElement(
                initial_value=constants.CONFIG_DESTINATION_AO["value"],
                options=orm.as_selector_options(
                    names=[
                        constants.CONFIG_DESTINATION_AO["name"],
                        # constants.CONFIG_DESTINATION_CURRENT["name"],
                        constants.CONFIG_DESTINATION_SPECIFIED["name"],
                    ],
                    values=[
                        constants.CONFIG_DESTINATION_AO["value"],
                        # constants.CONFIG_DESTINATION_CURRENT["value"],
                        constants.CONFIG_DESTINATION_SPECIFIED["value"],
                    ],
                ),
            ),
        ),
        orm.InputBlock(
            label="Specified Preblast Channel",
            action=actions.CONFIG_PREBLAST_DESTINATION_CHANNEL,
            optional=True,
            element=orm.ChannelsSelectElement(placeholder="Select the channel..."),
            hint="Only required if 'Specified Channel' is selected above.",
        ),
        orm.DividerBlock(),
        orm.InputBlock(
            label="Default Slack channel desination for backblasts",
            action=actions.CONFIG_DEFAULT_DESTINATION,
            optional=False,
            element=orm.RadioButtonsElement(
                initial_value=constants.CONFIG_DESTINATION_AO["value"],
                options=orm.as_selector_options(
                    names=[
                        constants.CONFIG_DESTINATION_AO["name"],
                        # constants.CONFIG_DESTINATION_CURRENT["name"],
                        constants.CONFIG_DESTINATION_SPECIFIED["name"],
                    ],
                    values=[
                        constants.CONFIG_DESTINATION_AO["value"],
                        # constants.CONFIG_DESTINATION_CURRENT["value"],
                        constants.CONFIG_DESTINATION_SPECIFIED["value"],
                    ],
                ),
            ),
        ),
        orm.InputBlock(
            label="Specified Channel",
            action=actions.CONFIG_DESTINATION_CHANNEL,
            optional=True,
            element=orm.ChannelsSelectElement(placeholder="Select the channel..."),
            hint="Only required if 'Specified Channel' is selected above.",
        ),
        orm.DividerBlock(),
        orm.InputBlock(
            label="Backblast Moleskine Template / Starter",
            action=actions.CONFIG_BACKBLAST_MOLESKINE_TEMPLATE,
            optional=True,
            element=orm.RichTextInputElement(),
        ),
        orm.InputBlock(
            label="Preblast Moleskine Template / Starter",
            action=actions.CONFIG_PREBLAST_MOLESKINE_TEMPLATE,
            optional=True,
            element=orm.RichTextInputElement(),
        ),
        orm.DividerBlock(),
        orm.InputBlock(
            label="Preblast Reminder Time (CST)",
            action=actions.CONFIG_PREBLAST_REMINDER_TIME,
            optional=True,
            element=orm.TimepickerElement(),
            hint="Reminder DMs will be sent to Qs this time the day before their event. Set this earlier than your automated/scheduled preblast times so Qs have a chance to fill out their own preblast first.",  # noqa
        ),
        orm.InputBlock(
            label="Automated Preblast Options",
            action=actions.CONFIG_AUTOMATED_PREBLAST,
            optional=False,
            element=orm.RadioButtonsElement(
                options=orm.as_selector_options(
                    names=["Send for Qs", "Send even if no Q", "Disable"], values=["q_only", "always", "disable"]
                ),  # noqa: E501
                initial_value="q_only",
            ),
        ),
        orm.InputBlock(
            label="Automated Preblast Time (CST)",
            action=actions.CONFIG_AUTOMATED_PREBLAST_TIME,
            optional=True,
            element=orm.TimepickerElement(),
            hint="Automated preblasts will be sent this time the day before if one has not been set by the Q.",  # noqa
        ),
        orm.InputBlock(
            label="Scheduled Preblast Time (CST)",
            action=actions.CONFIG_SCHEDULED_PREBLAST_TIME,
            optional=True,
            element=orm.TimepickerElement(),
            hint="Scheduled preblasts will be sent this time the day before when Q has set a preblast for 'send a day before'.",  # noqa
        ),
        orm.InputBlock(
            label="Backblast Reminder Count",
            action=actions.CONFIG_BACKBLAST_REMINDER_DAYS,
            optional=True,
            element=orm.NumberInputElement(
                placeholder="Enter the number of days...", is_decimal_allowed=False, min_value=0, max_value=7
            ),
            hint="This sets the number of reminders a Q will get until they complete their backblast. If set to 0, no reminders will be sent. Defaults to 5.",  # noqa
        ),
        orm.DividerBlock(),
        orm.InputBlock(
            label="HC Announcement in Preblast Thread",
            action=actions.CONFIG_HC_ANNOUNCE_OPTION,
            optional=False,
            element=orm.RadioButtonsElement(
                initial_value="off",
                options=orm.as_selector_options(
                    names=["Off", "Standard", "Snarky"],
                    values=["off", "standard", "snarky"],
                ),
            ),
            hint="When enabled, the bot posts a reply in the preblast thread when someone HC's or Un-HC's.",
        ),
        orm.InputBlock(
            label="HC Announcement Target",
            action=actions.CONFIG_HC_ANNOUNCE_TARGETS,
            optional=False,
            element=orm.RadioButtonsElement(
                initial_value="both",
                options=orm.as_selector_options(
                    names=["Both HCs and Un-HCs", "HCs Only", "Un-HCs Only"],
                    values=["both", "hc_only", "unhc_only"],
                ),
            ),
            hint="Select which actions trigger an announcement in the preblast thread.",
        ),
        orm.DividerBlock(),
        orm.InputBlock(
            label="Bot Action Log Channel",
            action=actions.CONFIG_BOT_LOG_CHANNEL,
            element=orm.ChannelsSelectElement(placeholder="Select a channel..."),
            optional=True,
            hint="When set, the bot will post a log message here whenever a key action occurs (e.g. event edited). If left blank and a log is triggered, the bot will auto-create #nation_bot_logs.",  # noqa
        ),
    ]
)

WELCOME_MESSAGE_CONFIG_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Enable Welcomebot welcome DMs?",
            action=actions.WELCOME_DM_ENABLE,
            optional=False,
            element=orm.RadioButtonsElement(
                initial_value="no",
                options=orm.as_selector_options(names=["Enable", "Disable"], values=["enable", "disable"]),
            ),
        ),
        orm.InputBlock(
            label="Welcome Message Template",
            action=actions.WELCOME_DM_TEMPLATE,
            optional=True,
            element=orm.RichTextInputElement(),
        ),
        orm.ContextBlock(
            element=orm.ContextElement(
                initial_value="*This content will be sent to any new user who joins this Slack workspace.*\n\n"
                + "This is a good time to tell an FNG or long-time Slack hold out what they need to know about your region and how you use Slack.\n"  # noqa: E501
                + "Who should they reach out to if they have a question? What channels should they join? What does HC mean and "  # noqa: E501
                + "how do they do that? Should their Slack handle be their F3 name?",
            ),
        ),
        orm.InputBlock(
            label="Enable Welcomebot welcome channel posts?",
            action=actions.WELCOME_CHANNEL_ENABLE,
            optional=False,
            element=orm.RadioButtonsElement(
                initial_value="disable",
                options=orm.as_selector_options(names=["Enable", "Disable"], values=["enable", "disable"]),
            ),
        ),
        orm.InputBlock(
            label="Welcomebot Channel",
            action=actions.WELCOME_CHANNEL,
            optional=False,
            element=orm.ChannelsSelectElement(placeholder="Select the channel..."),
            hint="If enabled, this is the channel where welcome messages will be posted.",
        ),
    ]
)

STRAVA_ACTIVITY_MODIFY_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Activity Title",
            action=actions.STRAVA_ACTIVITY_TITLE,
            optional=False,
            element=orm.PlainTextInputElement(
                initial_value="",
                placeholder="Enter a workout title...",
                max_length=100,
            ),
        ),
        orm.InputBlock(
            label="Activity Description",
            action=actions.STRAVA_ACTIVITY_DESCRIPTION,
            optional=False,
            element=orm.PlainTextInputElement(
                initial_value="",
                placeholder="Enter a workout description...",
                max_length=3000,
                multiline=True,
            ),
        ),
    ]
)

CUSTOM_FIELD_TYPE_MAP = {
    "Dropdown": orm.StaticSelectElement(),
    "Text": orm.PlainTextInputElement(),
    "Number": orm.NumberInputElement(),
}

CUSTOM_FIELD_ADD_EDIT_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            element=orm.PlainTextInputElement(
                initial_value="",
                multiline=False,
                placeholder="Enter the name of the new field or metric",
                max_length=40,
            ),
            action=actions.CUSTOM_FIELD_ADD_NAME,
            label="Field name / metric name",
            optional=False,
        ),
        orm.InputBlock(
            element=orm.StaticSelectElement(
                options=orm.as_selector_options(
                    names=CUSTOM_FIELD_TYPE_MAP.keys(),
                ),
                initial_value="Dropdown",
            ),
            action=actions.CUSTOM_FIELD_ADD_TYPE,
            label="Type of entry",
            optional=False,
            # dispatch_action=True, TODO: hide dropdown options if not "Dropdown"
        ),
        orm.InputBlock(
            element=orm.PlainTextInputElement(
                initial_value=" ",
                multiline=False,
                placeholder="Enter the options for the dropdown, separated by commas",
                max_length=100,
            ),
            action=actions.CUSTOM_FIELD_ADD_OPTIONS,
            label="Dropdown options (only required if 'Dropdown' is selected above)",
            optional=True,
            hint="Separate options with commas",
        ),
    ]
)

LOADING_FORM = orm.BlockView(
    blocks=[
        orm.SectionBlock(label=":hourglass: Loading, do not close...", action=actions.LOADING),
        orm.ContextBlock(
            action="loading_context",
            element=orm.ContextElement(
                initial_value="If this form does not update after ~10 seconds, an error may have occurred. Please try again.",  # noqa: E501
            ),
        ),
    ]
)

DEBUG_FORM = orm.BlockView(
    blocks=[
        orm.SectionBlock(label=":beetle: Debug Mode", action=actions.DEBUG),
        orm.ContextBlock(
            action="loading_context",
            element=orm.ContextElement(
                initial_value="If your call does not end in an updated view, you may have to close this manually.",  # noqa: E501
            ),
        ),
    ]
)

ERROR_FORM = orm.BlockView(
    blocks=[
        orm.SectionBlock(label=":warning: the following error occurred:", action=actions.ERROR_FORM_MESSAGE),
    ]
)

ACHIEVEMENT_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Achievement",
            action=actions.ACHIEVEMENT_SELECT,
            optional=False,
            element=orm.StaticSelectElement(placeholder="Select the achievement..."),
            hint="If you don't see the achievement you're looking for, talk to your Weasel Shaker / Tech Q about getting it added!",  # noqa: E501
        ),
        orm.InputBlock(
            label="Select the PAX",
            action=actions.ACHIEVEMENT_PAX,
            optional=False,
            element=orm.MultiUsersSelectElement(placeholder="Select the PAX..."),
        ),
        orm.InputBlock(
            label="Achievement Date",
            action=actions.ACHIEVEMENT_DATE,
            optional=False,
            element=orm.DatepickerElement(placeholder="Select the date..."),
            hint="Please use a date in the period the achievement was earned, as some achievements can be earned for several periods.",  # noqa: E501
        ),
    ]
)

WEASELBOT_CONFIG_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Which Weaselbot features should be enabled?",
            action=actions.WEASELBOT_ENABLE_FEATURES,
            element=orm.CheckboxInputElement(
                options=orm.as_selector_options(
                    names=["Achievements", "Kotter Reports"],
                    values=["achievements", "kotter_reports"],
                )
            ),
        ),
        orm.InputBlock(
            label="Which channel should achievements be posted to?",
            action=actions.WEASELBOT_ACHIEVEMENT_CHANNEL,
            optional=True,
            element=orm.ChannelsSelectElement(placeholder="Select the channel..."),
        ),
        orm.InputBlock(
            label="Which user or channel should Kotter Reports be posted to?",
            action=actions.WEASELBOT_KOTTER_CHANNEL,
            optional=True,
            element=orm.ConversationsSelectElement(placeholder="Select the user or channel..."),
            hint="Please note that Weaselbot will need to be manually added to private channels if selected.",
        ),
        orm.InputBlock(
            label="How many weeks of no posting should put a PAX on the Kotter Report?",
            action=actions.WEASELBOT_KOTTER_WEEKS,
            optional=True,
            element=orm.NumberInputElement(placeholder="Enter the number of weeks...", is_decimal_allowed=False),
        ),
        orm.InputBlock(
            label="After how many weeks of no posting should a PAX be removed from the Kotter Report?",
            action=actions.WEASELBOT_KOTTER_REMOVE_WEEKS,
            optional=True,
            element=orm.NumberInputElement(placeholder="Enter the number of weeks...", is_decimal_allowed=False),
        ),
        orm.InputBlock(
            label="How many weeks of activity should be used to base a PAX's home AO?",
            action=actions.WEASELBOT_HOME_AO_WEEKS,
            optional=True,
            element=orm.NumberInputElement(placeholder="Enter the number of weeks...", is_decimal_allowed=False),
        ),
        orm.InputBlock(
            label="After how many weeks of no Qing should a PAX be put on the Q list?",
            action=actions.WEASELBOT_Q_WEEKS,
            optional=True,
            element=orm.NumberInputElement(placeholder="Enter the number of weeks...", is_decimal_allowed=False),
        ),
        orm.InputBlock(
            label="What should be the minimum number of posts over that time to be eligible for the Q list?",
            action=actions.WEASELBOT_Q_POSTS,
            optional=True,
            element=orm.NumberInputElement(placeholder="Enter the number of posts...", is_decimal_allowed=False),
        ),
    ]
)


NO_WEASELBOT_CONFIG_FORM = orm.BlockView(
    blocks=[
        orm.SectionBlock(
            label="Weaselbot and / or PAXMiner doesn't appear to be configured for this Slack workspace. Please follow <https://github.com/F3Nation-Community/weaselbot|these instructions> to get started!",  # noqa: E501
        )
    ]
)

CONFIG_NO_PERMISSIONS_FORM = orm.BlockView(
    blocks=[
        orm.ActionsBlock(
            elements=[
                orm.ButtonElement(
                    label=":bust_in_silhouette: User Settings",
                    action=actions.CONFIG_USER_SETTINGS,
                ),
                orm.ButtonElement(
                    label=":hospital: Emergency Info Access",
                    action=actions.CONFIG_EMERGENCY_INFO,
                ),
                orm.ButtonElement(
                    label=":grey_question: Help Menu",
                    action=actions.CONFIG_HELP_MENU,
                ),
                orm.ButtonElement(
                    label=":airplane: Downrange",
                    action=actions.CONFIG_DOWNRANGE,
                ),
            ],
        ),
        orm.SectionBlock(
            label="Looking for region or calendar settings? You must be assigned as an admin for your region in order to access these.",  # noqa: E501
        ),
    ]
)

CONFIG_NEW_POSITION_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Position Name",
            action=actions.CONFIG_NEW_POSITION_NAME,
            optional=False,
            element=orm.PlainTextInputElement(placeholder="Enter the new position name..."),
        ),
        orm.InputBlock(
            label="Position Description",
            action=actions.CONFIG_NEW_POSITION_DESCRIPTION,
            optional=False,
            element=orm.PlainTextInputElement(placeholder="Enter the new position description..."),
        ),
    ]
)

BACKBLAST_LEGACY_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Title",
            action=actions.BACKBLAST_TITLE,
            optional=False,
            element=orm.PlainTextInputElement(placeholder="Enter a workout title..."),
        ),
        orm.InputBlock(
            label="Upload a boyband",
            element=orm.FileInputElement(
                max_files=1,
                filetypes=[
                    "png",
                    "jpg",
                    "heic",
                    "bmp",
                ],
            ),
            action=actions.BACKBLAST_FILE,
            optional=True,
        ),
        orm.InputBlock(
            label="The AO",
            action=actions.BACKBLAST_AO,
            optional=False,
            element=orm.ChannelsSelectElement(placeholder="Select the AO..."),
            dispatch_action=False,
        ),
        orm.InputBlock(
            label="Workout Date",
            action=actions.BACKBLAST_DATE,
            optional=False,
            element=orm.DatepickerElement(placeholder="Select the date..."),
            dispatch_action=False,
        ),
        orm.InputBlock(
            label="The Q",
            action=actions.BACKBLAST_Q,
            optional=False,
            element=orm.UsersSelectElement(placeholder="Select the Q..."),
            dispatch_action=False,
        ),
        orm.ContextBlock(
            action=actions.BACKBLAST_DUPLICATE_WARNING,
            element=orm.ContextElement(
                initial_value=":warning: :warning: *WARNING*: duplicate backblast detected in PAXMiner DB for this Q, "
                "AO, and date; this backblast will not be saved as-is. Please modify one of these selections",
            ),
        ),
        orm.InputBlock(
            label="The CoQ(s), if any",
            action=actions.BACKBLAST_COQ,
            optional=True,
            element=orm.MultiUsersSelectElement(placeholder="Select the CoQ(s)..."),
        ),
        orm.InputBlock(
            label="The PAX",
            action=actions.BACKBLAST_PAX,
            optional=False,
            element=orm.MultiUsersSelectElement(placeholder="Select the PAX..."),
            hint="Don't forget you can type to search in the dropdown menu!",
        ),
        orm.InputBlock(
            label="List untaggable PAX, separated by commas (not FNGs)",
            action=actions.BACKBLAST_NONSLACK_PAX,
            optional=True,
            element=orm.PlainTextInputElement(
                placeholder="Enter untaggable PAX...",
            ),
        ),
        orm.InputBlock(
            label="List FNGs, separated by commas",
            action=actions.BACKBLAST_FNGS,
            optional=True,
            element=orm.PlainTextInputElement(placeholder="Enter FNGs..."),
        ),
        orm.InputBlock(
            label="Total PAX Count",
            action=actions.BACKBLAST_COUNT,
            optional=True,
            element=orm.PlainTextInputElement(placeholder="Total PAX count including FNGs"),
        ),
        orm.ContextBlock(
            element=orm.ContextElement(
                initial_value="If left blank, this will be calculated automatically from the fields above.",
            ),
        ),
        orm.InputBlock(
            label="The Moleskine",
            action=actions.BACKBLAST_MOLESKIN,
            optional=False,
            element=orm.RichTextInputElement(),
            hint="Due to a known Slack issue, please avoid the use of hashtags (#) in the Moleskine.",
        ),
        orm.DividerBlock(),
        # orm.InputBlock(
        #     label="Choose where to post this",
        #     action=actions.BACKBLAST_DESTINATION,
        #     optional=False,
        #     element=orm.StaticSelectElement(placeholder="Select a destination..."),
        # ),
        orm.InputBlock(
            label="Email Backblast (to Wordpress, etc)",
            action=actions.BACKBLAST_EMAIL_SEND,
            optional=False,
            element=orm.RadioButtonsElement(
                options=orm.as_selector_options(names=["Send Email", "Don't Send Email"], values=["yes", "no"]),
                initial_value="yes",
            ),
        ),
    ]
)

PREBLAST_LEGACY_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Title",
            action=actions.PREBLAST_TITLE,
            optional=False,
            element=orm.PlainTextInputElement(placeholder="Enter a workout title..."),
        ),
        orm.InputBlock(
            label="The AO",
            action=actions.PREBLAST_AO,
            optional=False,
            element=orm.ChannelsSelectElement(placeholder="Select the AO..."),
        ),
        orm.InputBlock(
            label="Workout Date",
            action=actions.PREBLAST_DATE,
            optional=False,
            element=orm.DatepickerElement(
                placeholder="Select the date...",
            ),
        ),
        orm.InputBlock(
            label="Workout Time",
            action=actions.PREBLAST_TIME,
            optional=False,
            element=orm.TimepickerElement(),
        ),
        orm.InputBlock(
            label="The Q",
            action=actions.PREBLAST_Q,
            optional=False,
            element=orm.UsersSelectElement(placeholder="Select the Q..."),
        ),
        orm.InputBlock(
            label="Coupons?",
            action=actions.PREBLAST_COUPONS,
            optional=True,
            element=orm.PlainTextInputElement(  # TODO: change to radio buttons or checkboxes
                placeholder="Coupons or not?",
            ),
        ),
        orm.InputBlock(
            label="Moleskine",
            action=actions.PREBLAST_MOLESKIN,
            optional=True,
            element=orm.RichTextInputElement(),
        ),
        orm.DividerBlock(),
        orm.InputBlock(
            label="Choose where to post this",
            action=actions.PREBLAST_DESTINATION,
            optional=False,
            element=orm.StaticSelectElement(placeholder="Select a destination..."),
        ),
    ]
)

ALREADY_POSTED_FORM = orm.BlockView(
    blocks=[
        orm.SectionBlock(
            label="This backblast has already been posted! If you want to edit it, please use the "
            "edit button in the backblast post.",
            action=actions.ALREADY_POSTED,
        ),
        orm.ContextBlock(
            element=orm.ContextElement(
                initial_value="If you think this is an error, please contact your region's Weasel Shaker.",
            ),
        ),
    ]
)

SUBMIT_FORM = orm.BlockView(
    blocks=[
        orm.SectionBlock(
            label=":hourglass_flowing_sand: Your form has been submitted! Saving data and posting to Slack...",
            action="submit_form_message",
        ),
        orm.ContextBlock(
            action="submit_context",
            element=orm.ContextElement(
                initial_value="If this form does not close automatically after a few seconds, you can close it yourself."  # noqa: E501
            ),
        ),
    ]
)

SUBMIT_FORM_SUCCESS = orm.BlockView(
    blocks=[
        orm.SectionBlock(
            label=":white_check_mark: Your form has been submitted successfully! You can close this form now.",
            action="submit_form_success_message",
        ),
    ]
)
