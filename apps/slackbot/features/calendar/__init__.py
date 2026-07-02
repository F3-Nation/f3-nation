from typing import List

from utilities.slack import actions, orm

PREBLAST_MESSAGE_ACTION_ELEMENTS = [
    orm.ButtonElement(label=":hc: HC/Un-HC", action=actions.EVENT_PREBLAST_HC_UN_HC),
    orm.ButtonElement(label=":pencil: Edit Preblast", action=actions.EVENT_PREBLAST_EDIT, value="Edit Preblast"),
]


def get_preblast_action_buttons(has_q: bool = True, event_instance_id: int = None) -> List[orm.ButtonElement]:
    buttons = [
        orm.ButtonElement(label=":hc: HC/Un-HC", action=actions.EVENT_PREBLAST_HC_UN_HC),
        orm.ButtonElement(label=":pencil: Edit Preblast", action=actions.EVENT_PREBLAST_EDIT, value="Edit Preblast"),
        orm.ButtonElement(label=":heavy_plus_sign: New Preblast", action=actions.NEW_PREBLAST_BUTTON),
    ]
    if not has_q:
        buttons.append(
            orm.ButtonElement(
                label=":raising_hand: Take Q", action=actions.EVENT_PREBLAST_TAKE_Q, value=str(event_instance_id)
            )
        )
    if event_instance_id:
        buttons.append(
            orm.ButtonElement(
                label=":back: Fill Backblast",
                action=actions.PREBLAST_FILL_BACKBLAST_BUTTON,
                value=str(event_instance_id),
            )
        )
    return buttons


def get_preblast_action_blocks(has_q: bool = True, event_instance_id: int = None) -> List[orm.BaseBlock]:
    overflow_labels = [
        ":pencil: Edit Preblast",
        ":heavy_plus_sign: New Preblast",
        # orm.ButtonElement(label=":pencil: Edit Preblast", action=actions.EVENT_PREBLAST_EDIT, value="Edit Preblast"),
        # orm.ButtonElement(label=":heavy_plus_sign: New Preblast", action=actions.NEW_PREBLAST_BUTTON),
    ]
    overflow_values = [
        f"{actions.EVENT_PREBLAST_EDIT}_{event_instance_id}",
        actions.NEW_PREBLAST_BUTTON,
    ]
    if event_instance_id:
        overflow_labels.append(":back: Fill Backblast")
        overflow_values.append(f"{actions.PREBLAST_FILL_BACKBLAST_BUTTON}_{event_instance_id}")
    blocks = [
        orm.ActionsBlock(
            action="hc-un-hc-actions",
            elements=[
                orm.ButtonElement(label=":hc: HC/Un-HC", action=actions.EVENT_PREBLAST_HC_UN_HC),
                orm.OverflowElement(
                    action=actions.PREBLAST_OVERFLOW_ACTION,
                    options=orm.as_selector_options(names=overflow_labels, values=overflow_values),
                ),
            ],
        ),
        # orm.ButtonElement(label=":pencil: Edit Preblast", action=actions.EVENT_PREBLAST_EDIT, value="Edit Preblast"),
        # orm.ButtonElement(label=":heavy_plus_sign: New Preblast", action=actions.NEW_PREBLAST_BUTTON),
    ]
    if not has_q:
        blocks.insert(
            0,
            orm.ActionsBlock(
                action="take-q-action",
                elements=[
                    orm.ButtonElement(
                        label=":raising_hand: Take Q",
                        action=actions.EVENT_PREBLAST_TAKE_Q,
                        value=str(event_instance_id),
                    )
                ],
            ),
        )
    return blocks
