import unittest


def assert_edit_delete_selector(
    test_case: unittest.TestCase, view: dict, *, callback_id: str, action_id: str, label: str
) -> dict:
    """Check the shared selector contract and return it for action-specific assertions."""
    test_case.assertEqual(view["callback_id"], callback_id)
    block = next(b for b in view["blocks"] if b.get("block_id") == action_id)
    test_case.assertEqual(block["text"]["text"], label)
    selector = block["accessory"]
    test_case.assertEqual(selector["action_id"], action_id)
    test_case.assertEqual(selector["placeholder"]["text"], "Edit or Delete")
    test_case.assertEqual(
        [(o["text"]["text"], o["value"]) for o in selector["options"]],
        [("Edit", "Edit"), ("Delete", "Delete")],
    )
    return selector
