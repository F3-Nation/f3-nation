# F3 Nation Slack Bot - Testing Strategy

## Executive Summary

This document outlines a phased approach to implementing a comprehensive testing suite for the F3 Nation Slack Bot. The current codebase has minimal test coverage (only 2 test files), and this strategy will establish pytest-based testing that works both locally and in GitHub Actions CI/CD pipelines.

**Current State:**

- Minimal tests: `test/features/calendar/test_event_tag.py` (unittest-based) and `test/utilities/test_helper_functions.py`
- No test runner configured in `pyproject.toml`
- No CI/CD pipeline for automated testing
- No test fixtures or shared test utilities

**Target State:**

- Comprehensive pytest-based test suite with >70% coverage
- Automated testing in GitHub Actions
- Clear test patterns and fixtures for future development
- Fast, reliable tests that can run in isolation

---

## Testing Framework Selection

**Primary Framework: pytest**

**Rationale:**

- Industry standard for Python projects
- Better fixture system than unittest
- More concise test syntax
- Excellent plugin ecosystem (pytest-cov, pytest-mock, pytest-asyncio)
- Compatible with existing unittest tests (can run both)
- Better parameterization support
- Superior output and error reporting

**Supporting Tools:**

- `pytest-cov` - Code coverage reporting
- `pytest-mock` - Enhanced mocking capabilities
- `pytest-asyncio` - For any async code testing
- `faker` - Generate realistic test data
- `freezegun` - Time/date mocking
- `responses` - Mock HTTP requests

---

## Test Architecture

### Test Organization

```
test/
├── conftest.py                    # Shared fixtures and configuration
├── fixtures/                      # Reusable test fixtures
│   ├── __init__.py
│   ├── slack_fixtures.py         # Mock Slack clients, events, bodies
│   ├── database_fixtures.py      # Mock DB managers, models
│   └── region_fixtures.py        # Mock SlackSettings, region data
├── unit/                          # Unit tests (isolated)
│   ├── features/
│   │   ├── test_backblast.py
│   │   ├── test_preblast.py
│   │   ├── calendar/
│   │   │   ├── test_event_tag.py
│   │   │   ├── test_event_type.py
│   │   │   └── test_home.py
│   │   └── ...
│   ├── utilities/
│   │   ├── test_helper_functions.py
│   │   ├── test_routing.py
│   │   ├── slack/
│   │   │   ├── test_sdk_orm.py
│   │   │   └── test_actions.py
│   │   └── database/
│   │       └── test_orm.py
│   └── scripts/
│       ├── test_hourly_runner.py
│       └── test_calendar_images.py
├── integration/                   # Integration tests
│   ├── test_slack_events.py     # End-to-end Slack event flow
│   ├── test_database_operations.py
│   └── test_routing_integration.py
└── e2e/                          # End-to-end tests (optional, Phase 4)
    └── test_full_workflows.py
```

### Test Types

1. **Unit Tests** - Test individual functions/classes in isolation
   - Mock all external dependencies (DB, Slack API, external services)
   - Fast execution (<1s per test)
   - 80% of test suite

2. **Integration Tests** - Test component interactions
   - Use test database or in-memory SQLite
   - Mock only external APIs (Slack, AWS, etc.)
   - Medium execution time (1-5s per test)
   - 15% of test suite

3. **End-to-End Tests** - Test complete user workflows (optional)
   - Use staging environment or test workspace
   - Minimal mocking
   - Slow execution (5-30s per test)
   - 5% of test suite

---

## Phase 1: Foundation Setup (2-3 hours)

### Objectives

- Install and configure pytest
- Create shared test fixtures
- Set up test database configuration
- Migrate existing unittest tests to pytest
- Establish testing conventions

### Step-by-Step Instructions

#### 1.1 Install Testing Dependencies

Add to `pyproject.toml` under `[tool.poetry.group.test.dependencies]`:

```bash
poetry add --group test pytest pytest-cov pytest-mock pytest-asyncio faker freezegun responses
```

Expected additions:

```toml
[tool.poetry.group.test.dependencies]
pytest = "^8.0.0"
pytest-cov = "^5.0.0"
pytest-mock = "^3.14.0"
pytest-asyncio = "^0.23.0"
faker = "^30.0.0"
freezegun = "^1.5.0"
responses = "^0.25.0"
```

Then sync:

```bash
poetry export -f requirements.txt -o requirements.txt --without-hashes
```

#### 1.2 Create pytest Configuration

Create `pytest.ini` in project root:

```ini
[pytest]
testpaths = test
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts =
    -v
    --strict-markers
    --cov=.
    --cov-report=term-missing
    --cov-report=html
    --cov-report=xml
    --cov-config=.coveragerc
    --ignore=test/e2e
markers =
    unit: Unit tests (fast, isolated)
    integration: Integration tests (use test DB)
    e2e: End-to-end tests (slow, require full environment)
    slow: Tests that take more than 1 second
```

Create `.coveragerc` in project root:

```ini
[run]
source = .
omit =
    */test/*
    */tests/*
    */__pycache__/*
    */site-packages/*
    */dist-packages/*
    .venv/*
    venv/*
    */scripts/*
    */db-init/*

[report]
exclude_lines =
    pragma: no cover
    def __repr__
    raise AssertionError
    raise NotImplementedError
    if __name__ == .__main__.:
    if TYPE_CHECKING:
    @abstractmethod
```

#### 1.3 Create Test Fixtures

Create `test/conftest.py`:

```python
"""Shared pytest fixtures for all tests."""
import pytest
from unittest.mock import MagicMock, Mock
from logging import Logger

from utilities.database.orm import SlackSettings


@pytest.fixture
def mock_logger():
    """Mock logger for testing."""
    return MagicMock(spec=Logger)


@pytest.fixture
def mock_slack_client():
    """Mock Slack WebClient for testing."""
    client = MagicMock()
    client.views_open.return_value = {"ok": True}
    client.views_update.return_value = {"ok": True}
    client.chat_postMessage.return_value = {"ok": True, "ts": "1234567890.123456"}
    return client


@pytest.fixture
def mock_context():
    """Mock Slack context object."""
    return {
        "team_id": "T12345678",
        "user_id": "U12345678",
        "bot_token": "xoxb-test-token",
    }


@pytest.fixture
def mock_region_record():
    """Mock SlackSettings/region record."""
    return SlackSettings(
        team_id="T12345678",
        org_id=1,
        workspace_name="Test Workspace",
        db_id=1,
        bot_token="xoxb-test-token",
        email_enabled=0,
        postie_format=0,
        editing_locked=0,
        strava_enabled=0,
        welcome_dm_enable=0,
        welcome_channel_enable=0,
        send_achievements=0,
        send_aoq_reports=0,
        NO_POST_THRESHOLD=4,
        REMINDER_WEEKS=8,
        HOME_AO_CAPTURE=1,
    )


@pytest.fixture
def sample_slack_body():
    """Sample Slack event body."""
    return {
        "type": "block_actions",
        "team": {"id": "T12345678", "domain": "test-workspace"},
        "user": {
            "id": "U12345678",
            "username": "testuser",
            "name": "Test User",
        },
        "trigger_id": "1234567890.1234567890.abcdef1234567890",
        "team_id": "T12345678",
    }


@pytest.fixture
def sample_view_submission():
    """Sample view submission body."""
    return {
        "type": "view_submission",
        "team": {"id": "T12345678"},
        "user": {"id": "U12345678"},
        "view": {
            "id": "V12345678",
            "callback_id": "test-callback-id",
            "state": {
                "values": {}
            },
            "private_metadata": "{}",
        },
    }
```

Create `test/fixtures/slack_fixtures.py`:

```python
"""Slack-specific test fixtures."""
import pytest
from unittest.mock import MagicMock


@pytest.fixture
def slack_action_body(sample_slack_body):
    """Slack action event body."""
    body = sample_slack_body.copy()
    body["actions"] = [
        {
            "action_id": "test-action",
            "block_id": "test-block",
            "value": "test-value",
            "type": "button",
        }
    ]
    return body


@pytest.fixture
def slack_command_body():
    """Slack slash command body."""
    return {
        "token": "test-token",
        "team_id": "T12345678",
        "team_domain": "test-workspace",
        "channel_id": "C12345678",
        "channel_name": "general",
        "user_id": "U12345678",
        "user_name": "testuser",
        "command": "/test-command",
        "text": "",
        "api_app_id": "A12345678",
        "trigger_id": "1234567890.1234567890.abcdef1234567890",
    }
```

Create `test/fixtures/database_fixtures.py`:

```python
"""Database-related test fixtures."""
import pytest
from unittest.mock import MagicMock, patch


@pytest.fixture
def mock_db_manager():
    """Mock DbManager for testing."""
    with patch("f3_data_models.utils.DbManager") as mock_manager:
        # Setup common return values
        mock_manager.get.return_value = None
        mock_manager.find_records.return_value = []
        mock_manager.create_record.return_value = None
        mock_manager.update_record.return_value = None
        mock_manager.delete_record.return_value = None
        yield mock_manager


@pytest.fixture
def mock_org():
    """Mock Org model."""
    from f3_data_models.models import Org
    org = MagicMock(spec=Org)
    org.id = 1
    org.name = "Test Region"
    org.event_tags = []
    org.event_types = []
    org.locations = []
    return org


@pytest.fixture
def mock_event_tag():
    """Mock EventTag model."""
    from f3_data_models.models import EventTag
    tag = MagicMock(spec=EventTag)
    tag.id = 1
    tag.name = "Test Tag"
    tag.color = "blue"
    tag.specific_org_id = 1
    return tag
```

#### 1.4 Migrate Existing Tests

Refactor `test/utilities/test_helper_functions.py` to use pytest fixtures:

```python
"""Tests for helper_functions module."""
import pytest
from utilities.helper_functions import safe_get


class TestSafeGet:
    """Tests for safe_get function."""

    def test_nested_dict_access(self):
        """Test accessing nested dictionary values."""
        data = {"a": {"b": {"c": 1}}}
        assert safe_get(data, "a", "b", "c") == 1

    def test_missing_key_returns_none(self):
        """Test that missing keys return None."""
        data = {"a": {"b": {"c": 1}}}
        assert safe_get(data, "a", "b", "d") is None

    def test_none_data_returns_none(self):
        """Test that None input returns None."""
        assert safe_get(None, "a", "b") is None

    def test_list_index_access(self):
        """Test accessing list elements by index."""
        data = {"items": [1, 2, 3]}
        assert safe_get(data, "items", 0) == 1
        assert safe_get(data, "items", 5) is None

    @pytest.mark.parametrize("data,keys,expected", [
        ({"a": 1}, ["a"], 1),
        ({"a": {"b": 2}}, ["a", "b"], 2),
        ({"a": [1, 2, 3]}, ["a", 1], 2),
        ({}, ["a"], None),
    ])
    def test_various_access_patterns(self, data, keys, expected):
        """Test various data access patterns."""
        assert safe_get(data, *keys) == expected
```

#### 1.5 Create Test Running Scripts

Create `test.sh` (for local testing):

```bash
#!/bin/bash
# Run tests with coverage

set -e

echo "Running pytest with coverage..."
poetry run pytest

echo ""
echo "Coverage report generated:"
echo "  - Terminal: See above"
echo "  - HTML: htmlcov/index.html"
echo "  - XML: coverage.xml"
```

Make executable:

```bash
chmod +x test.sh
```

#### 1.6 Update .gitignore

Add to `.gitignore`:

```
# Testing
.pytest_cache/
.coverage
htmlcov/
coverage.xml
.tox/
```

---

## Phase 2: Core Utilities Testing (3-4 hours)

### Objectives

- Test all utility functions with high coverage
- Establish patterns for testing helper functions
- Test routing logic
- Test Slack ORM wrappers

### Step-by-Step Instructions

#### 2.1 Test Helper Functions

Create `test/unit/utilities/test_helper_functions.py`:

**Priority Functions to Test:**

- `safe_get()` - nested data access ✓ (already has basic tests)
- `get_region_record()` - fetch SlackSettings
- `safe_convert()` - type conversion
- `get_location_display_name()` - location formatting
- `trigger_map_revalidation()` - external API call

Example test structure:

```python
"""Comprehensive tests for helper_functions module."""
import pytest
from unittest.mock import patch, MagicMock
from utilities.helper_functions import (
    safe_get,
    safe_convert,
    get_location_display_name,
    get_region_record,
    trigger_map_revalidation,
)
from f3_data_models.models import Location


@pytest.mark.unit
class TestSafeConvert:
    """Tests for safe_convert function."""

    def test_convert_to_int(self):
        """Test converting string to int."""
        assert safe_convert("123", int) == 123

    def test_convert_none_returns_none(self):
        """Test that None returns None."""
        assert safe_convert(None, int) is None

    def test_invalid_conversion_returns_none(self):
        """Test that invalid conversions return None."""
        assert safe_convert("abc", int) is None

    @pytest.mark.parametrize("value,target_type,expected", [
        ("123", int, 123),
        ("12.5", float, 12.5),
        ("true", bool, True),
        (None, str, None),
    ])
    def test_various_conversions(self, value, target_type, expected):
        """Test various type conversions."""
        assert safe_convert(value, target_type) == expected


@pytest.mark.unit
class TestGetLocationDisplayName:
    """Tests for get_location_display_name function."""

    def test_returns_name_when_present(self):
        """Test that name is returned when available."""
        location = Location(name="Test AO", description="", address_street="")
        assert get_location_display_name(location) == "Test AO"

    def test_returns_description_when_no_name(self):
        """Test that description is used when name is empty."""
        location = Location(name="", description="Park near the school", address_street="")
        assert get_location_display_name(location) == "Park near the school"

    def test_truncates_long_description(self):
        """Test that long descriptions are truncated."""
        long_desc = "A" * 50
        location = Location(name="", description=long_desc, address_street="")
        result = get_location_display_name(location)
        assert len(result) == 30

    def test_returns_unnamed_location_fallback(self):
        """Test fallback for locations with no identifying info."""
        location = Location(name="", description="", address_street="")
        assert get_location_display_name(location) == "Unnamed Location"


@pytest.mark.unit
class TestGetRegionRecord:
    """Tests for get_region_record function."""

    @patch("utilities.helper_functions.REGION_RECORDS")
    def test_returns_cached_record(self, mock_cache, mock_region_record):
        """Test that cached region record is returned."""
        mock_cache.__getitem__.return_value = mock_region_record

        result = get_region_record(
            "T12345678",
            {"team_id": "T12345678"},
            {},
            MagicMock(),
            MagicMock(),
        )

        assert result == mock_region_record

    # Add more tests for database lookups, OAuth flows, etc.


@pytest.mark.unit
class TestTriggerMapRevalidation:
    """Tests for trigger_map_revalidation function."""

    @patch("utilities.helper_functions.requests.post")
    @patch.dict("os.environ", {
        "MAP_REVALIDATION_URL": "https://example.com/api/revalidate",
        "MAP_REVALIDATION_KEY": "test-key"
    })
    def test_successful_revalidation(self, mock_post):
        """Test successful map revalidation."""
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_post.return_value = mock_response

        result = trigger_map_revalidation()

        assert result is True
        mock_post.assert_called_once_with(
            url="https://example.com/api/revalidate",
            headers={
                "Content-Type": "application/json",
                "x-api-key": "test-key",
            }
        )

    @patch("utilities.helper_functions.requests.post")
    def test_failed_revalidation(self, mock_post):
        """Test failed map revalidation."""
        mock_post.side_effect = Exception("Network error")

        result = trigger_map_revalidation()

        assert result is False
```

#### 2.2 Test Routing Logic

Create `test/unit/utilities/test_routing.py`:

```python
"""Tests for routing module."""
import pytest
from unittest.mock import MagicMock, patch
from utilities.routing import (
    COMMAND_MAPPER,
    ACTION_MAPPER,
    VIEW_MAPPER,
    MAIN_MAPPER,
)
from utilities.slack import actions


@pytest.mark.unit
class TestRoutingMappers:
    """Tests for routing mapper structures."""

    def test_command_mapper_structure(self):
        """Test that COMMAND_MAPPER has correct structure."""
        for command, (handler, show_loading) in COMMAND_MAPPER.items():
            assert isinstance(command, str)
            assert command.startswith("/")
            assert callable(handler)
            assert isinstance(show_loading, bool)

    def test_action_mapper_structure(self):
        """Test that ACTION_MAPPER has correct structure."""
        for action_id, (handler, show_loading) in ACTION_MAPPER.items():
            assert isinstance(action_id, str)
            assert callable(handler)
            assert isinstance(show_loading, bool)

    def test_view_mapper_structure(self):
        """Test that VIEW_MAPPER has correct structure."""
        for callback_id, (handler, show_loading) in VIEW_MAPPER.items():
            assert isinstance(callback_id, str)
            assert callable(handler)
            assert isinstance(show_loading, bool)

    def test_main_mapper_contains_all_types(self):
        """Test that MAIN_MAPPER includes all event types."""
        assert "command" in MAIN_MAPPER
        assert "block_actions" in MAIN_MAPPER
        assert "view_submission" in MAIN_MAPPER
        assert "event_callback" in MAIN_MAPPER
        assert "block_suggestion" in MAIN_MAPPER

    def test_all_action_constants_are_mapped(self):
        """Test that action constants have handlers."""
        # Get all action constants from actions module
        action_constants = [
            getattr(actions, attr) for attr in dir(actions)
            if not attr.startswith("_") and isinstance(getattr(actions, attr), str)
        ]

        # Check commonly used actions are mapped
        important_actions = [
            actions.BACKBLAST_NEW_BUTTON,
            actions.PREBLAST_NEW_BUTTON,
            actions.CONFIG_GENERAL,
        ]

        for action in important_actions:
            assert action in ACTION_MAPPER, f"Action {action} not mapped"
```

#### 2.3 Test Slack SDK ORM Wrapper

Create `test/unit/utilities/slack/test_sdk_orm.py`:

```python
"""Tests for SDK ORM wrapper."""
import pytest
from unittest.mock import MagicMock, patch
from slack_sdk.models.blocks import InputBlock, SectionBlock
from slack_sdk.models.blocks.block_elements import PlainTextInputElement
from slack_sdk.models.blocks.basic_components import PlainTextObject, Option

from utilities.slack.sdk_orm import SdkBlockView, as_selector_options


@pytest.mark.unit
class TestAsSelectorOptions:
    """Tests for as_selector_options helper."""

    def test_creates_options_from_names(self):
        """Test creating options from name list."""
        names = ["Option 1", "Option 2", "Option 3"]
        options = as_selector_options(names)

        assert len(options) == 3
        assert all(isinstance(opt, Option) for opt in options)
        assert options[0].text.text == "Option 1"
        assert options[0].value == "Option 1"

    def test_uses_custom_values(self):
        """Test creating options with custom values."""
        names = ["Option 1", "Option 2"]
        values = ["val1", "val2"]
        options = as_selector_options(names, values)

        assert options[0].value == "val1"
        assert options[1].value == "val2"

    def test_adds_descriptions(self):
        """Test adding descriptions to options."""
        names = ["Option 1"]
        values = ["val1"]
        descriptions = ["This is option 1"]
        options = as_selector_options(names, values, descriptions)

        assert options[0].description.text == "This is option 1"

    def test_empty_list_returns_no_options_message(self):
        """Test that empty list returns placeholder."""
        options = as_selector_options([])

        assert len(options) == 1
        assert options[0].text.text == "No options available"


@pytest.mark.unit
class TestSdkBlockView:
    """Tests for SdkBlockView wrapper class."""

    def test_initialization(self):
        """Test initializing with blocks."""
        blocks = [SectionBlock(text="Test")]
        view = SdkBlockView(blocks)

        assert len(view.blocks) == 1
        assert view.blocks[0].text == "Test"

    def test_delete_block(self):
        """Test deleting a block by ID."""
        blocks = [
            SectionBlock(text="Block 1", block_id="block1"),
            SectionBlock(text="Block 2", block_id="block2"),
        ]
        view = SdkBlockView(blocks)

        view.delete_block("block1")

        assert len(view.blocks) == 1
        assert view.blocks[0].block_id == "block2"

    def test_add_block(self):
        """Test adding a block."""
        view = SdkBlockView([])
        new_block = SectionBlock(text="New Block")

        view.add_block(new_block)

        assert len(view.blocks) == 1
        assert view.blocks[0].text == "New Block"

    def test_get_block(self):
        """Test retrieving a block by ID."""
        blocks = [SectionBlock(text="Test", block_id="test-block")]
        view = SdkBlockView(blocks)

        block = view.get_block("test-block")

        assert block is not None
        assert block.text == "Test"

    def test_get_nonexistent_block_returns_none(self):
        """Test that getting nonexistent block returns None."""
        view = SdkBlockView([])

        block = view.get_block("nonexistent")

        assert block is None

    def test_set_initial_values_text_input(self):
        """Test setting initial value for text input."""
        input_block = InputBlock(
            label=PlainTextObject(text="Name"),
            element=PlainTextInputElement(),
            block_id="name_input"
        )
        view = SdkBlockView([input_block])

        view.set_initial_values({"name_input": "John Doe"})

        assert view.blocks[0].element.initial_value == "John Doe"
```

---

## Phase 3: Feature Module Testing (6-8 hours)

### Objectives

- Test Service classes (business logic)
- Test View classes (UI construction)
- Test handler functions (integration)
- Achieve >70% coverage for features

### Step-by-Step Instructions

#### 3.1 Test Modern Pattern Feature (Event Tag)

The existing `test/features/calendar/test_event_tag.py` provides a good template. Enhance it:

**Create:** `test/unit/features/calendar/test_event_tag.py`

Improvements needed:

1. Convert from unittest to pytest
2. Add more edge cases
3. Test error handling
4. Add parameterized tests

Example enhanced version:

```python
"""Tests for event_tag feature module."""
import pytest
from unittest.mock import MagicMock, patch, call
import json

from f3_data_models.models import EventTag, Org
from features.calendar.event_tag import (
    EventTagService,
    EventTagViews,
    handle_event_tag_add,
    handle_event_tag_edit_delete,
    manage_event_tags,
    CALENDAR_ADD_EVENT_TAG_SELECT,
    CALENDAR_ADD_EVENT_TAG_NEW,
    CALENDAR_ADD_EVENT_TAG_COLOR,
)


@pytest.mark.unit
class TestEventTagService:
    """Tests for EventTagService class."""

    @patch("features.calendar.event_tag.DbManager")
    def test_get_org_event_tags_filters_by_org(self, mock_db, mock_org):
        """Test that only org-specific tags are returned."""
        # Setup org with mixed tags
        org_tag = EventTag(id=1, name="Org Tag", color="Red", specific_org_id=1)
        global_tag = EventTag(id=2, name="Global Tag", color="Blue", specific_org_id=None)
        mock_org.event_tags = [org_tag, global_tag]
        mock_db.get.return_value = mock_org

        service = EventTagService()
        result = service.get_org_event_tags(1)

        # Should only return org-specific tag
        assert len(result) == 1
        assert result[0].name == "Org Tag"

    @patch("features.calendar.event_tag.DbManager")
    def test_get_available_global_tags_excludes_existing(self, mock_db, mock_org):
        """Test that already-added global tags are excluded."""
        # Org already has tag ID 1
        existing_tag = EventTag(id=1, name="Existing", color="Red")
        mock_org.event_tags = [existing_tag]
        mock_db.get.return_value = mock_org

        # Global tags include 1 and 2
        all_tags = [
            EventTag(id=1, name="Existing", color="Red"),
            EventTag(id=2, name="Available", color="Blue"),
        ]
        mock_db.find_records.return_value = all_tags

        service = EventTagService()
        result = service.get_available_global_tags(1)

        # Should only return tag ID 2
        assert len(result) == 1
        assert result[0].id == 2

    @patch("features.calendar.event_tag.DbManager")
    def test_create_org_specific_tag_validation(self, mock_db):
        """Test creating org-specific tag with validation."""
        service = EventTagService()
        service.create_org_specific_tag("VQ", "green", 1)

        # Verify create_record was called
        mock_db.create_record.assert_called_once()

        # Verify the created tag has correct attributes
        created_tag = mock_db.create_record.call_args[0][0]
        assert isinstance(created_tag, EventTag)
        assert created_tag.name == "VQ"
        assert created_tag.color == "green"
        assert created_tag.specific_org_id == 1

    @patch("features.calendar.event_tag.DbManager")
    def test_update_org_specific_tag(self, mock_db):
        """Test updating an existing tag."""
        service = EventTagService()
        service.update_org_specific_tag(1, "Updated Name", "yellow")

        mock_db.update_record.assert_called_once_with(
            EventTag,
            1,
            {EventTag.name: "Updated Name", EventTag.color: "yellow"}
        )

    @patch("features.calendar.event_tag.DbManager")
    def test_delete_org_specific_tag(self, mock_db):
        """Test deleting a tag."""
        service = EventTagService()
        service.delete_org_specific_tag(5)

        mock_db.delete_record.assert_called_once_with(EventTag, 5)


@pytest.mark.unit
class TestEventTagViews:
    """Tests for EventTagViews class."""

    def test_build_add_tag_modal_structure(self):
        """Test modal has correct structure."""
        available_tags = [EventTag(id=2, name="Available", color="Blue")]
        org_tags = []

        views = EventTagViews()
        form = views.build_add_tag_modal(available_tags, org_tags)

        # Should have expected number of blocks
        assert len(form.blocks) > 0

        # Should have selector with available tags
        selector_block = form.get_block(CALENDAR_ADD_EVENT_TAG_SELECT)
        assert selector_block is not None

    def test_build_edit_tag_modal_populates_values(self, mock_event_tag):
        """Test that edit modal is pre-populated."""
        views = EventTagViews()
        form = views.build_edit_tag_modal(mock_event_tag, [])

        # Should have initial values set
        # (This tests the set_initial_values call)
        assert form.get_block(CALENDAR_ADD_EVENT_TAG_NEW) is not None
        assert form.get_block(CALENDAR_ADD_EVENT_TAG_COLOR) is not None

    def test_build_tag_list_modal_creates_edit_buttons(self):
        """Test that tag list has edit button for each tag."""
        org_tags = [
            EventTag(id=1, name="Tag 1", color="Red"),
            EventTag(id=2, name="Tag 2", color="Blue"),
        ]

        views = EventTagViews()
        form = views.build_tag_list_modal(org_tags)

        # Should have block for each tag (plus context block)
        assert len(form.blocks) == 3


@pytest.mark.unit
class TestEventTagHandlers:
    """Tests for event_tag handler functions."""

    @patch("features.calendar.event_tag.EventTagService")
    @patch("features.calendar.event_tag.EventTagViews")
    def test_manage_event_tags_add_action(
        self,
        mock_views_class,
        mock_service_class,
        slack_action_body,
        mock_slack_client,
        mock_logger,
        mock_context,
        mock_region_record,
    ):
        """Test manage_event_tags with 'add' action."""
        # Setup body for "add" action
        slack_action_body["actions"][0]["selected_option"] = {"value": "add"}

        # Setup mocks
        mock_service = MagicMock()
        mock_service.get_available_global_tags.return_value = []
        mock_service.get_org_event_tags.return_value = []
        mock_service_class.return_value = mock_service

        mock_views = MagicMock()
        mock_form = MagicMock()
        mock_views.build_add_tag_modal.return_value = mock_form
        mock_views_class.return_value = mock_views

        # Execute
        manage_event_tags(
            slack_action_body,
            mock_slack_client,
            mock_logger,
            mock_context,
            mock_region_record,
        )

        # Verify service calls
        mock_service.get_available_global_tags.assert_called_once_with(
            mock_region_record.org_id
        )
        mock_service.get_org_event_tags.assert_called_once_with(
            mock_region_record.org_id
        )

        # Verify modal was posted
        mock_form.post_modal.assert_called_once()

    @patch("features.calendar.event_tag.EVENT_TAG_FORM")
    @patch("features.calendar.event_tag.EventTagService")
    def test_handle_event_tag_add_creates_new_tag(
        self,
        mock_service_class,
        mock_form,
        sample_view_submission,
        mock_slack_client,
        mock_logger,
        mock_context,
        mock_region_record,
    ):
        """Test creating a new tag via form submission."""
        # Setup form values
        mock_form.get_selected_values.return_value = {
            CALENDAR_ADD_EVENT_TAG_NEW: "New Tag",
            CALENDAR_ADD_EVENT_TAG_COLOR: "purple",
            CALENDAR_ADD_EVENT_TAG_SELECT: None,
        }

        mock_service = MagicMock()
        mock_service_class.return_value = mock_service

        # Execute
        handle_event_tag_add(
            sample_view_submission,
            mock_slack_client,
            mock_logger,
            mock_context,
            mock_region_record,
        )

        # Verify service method called
        mock_service.create_org_specific_tag.assert_called_once_with(
            "New Tag",
            "purple",
            mock_region_record.org_id
        )

    @pytest.mark.parametrize("action_value,expected_method", [
        ("Edit", "build_edit_tag_modal"),
        ("Delete", "delete_org_specific_tag"),
    ])
    @patch("features.calendar.event_tag.DbManager")
    @patch("features.calendar.event_tag.EventTagService")
    @patch("features.calendar.event_tag.EventTagViews")
    def test_handle_event_tag_edit_delete_actions(
        self,
        mock_views_class,
        mock_service_class,
        mock_db,
        action_value,
        expected_method,
        slack_action_body,
        mock_slack_client,
        mock_logger,
        mock_context,
        mock_region_record,
        mock_event_tag,
    ):
        """Test edit and delete actions."""
        # Setup action body
        slack_action_body["actions"][0]["action_id"] = "event-tag-edit-delete_5"
        slack_action_body["actions"][0]["selected_option"] = {"value": action_value}

        mock_db.get.return_value = mock_event_tag
        mock_service = MagicMock()
        mock_service_class.return_value = mock_service
        mock_views = MagicMock()
        mock_views_class.return_value = mock_views

        # Execute
        handle_event_tag_edit_delete(
            slack_action_body,
            mock_slack_client,
            mock_logger,
            mock_context,
            mock_region_record,
        )

        # Verify appropriate method was called
        if action_value == "Edit":
            mock_views.build_edit_tag_modal.assert_called_once()
        else:
            mock_service.delete_org_specific_tag.assert_called_once_with(5)
```

#### 3.2 Create Test Template for Legacy Features

Create `test/unit/features/test_backblast.py`:

**Test Structure for Legacy Features:**

1. Test build functions (modal construction)
2. Test handle functions (form processing)
3. Mock all external dependencies
4. Test error handling

Example structure:

```python
"""Tests for backblast feature module."""
import pytest
from unittest.mock import MagicMock, patch, ANY
from features import backblast
from utilities.slack import actions


@pytest.mark.unit
class TestBackblastMiddleware:
    """Tests for backblast_middleware function."""

    @patch("features.backblast.build_backblast_form")
    def test_middleware_calls_build_form(
        self,
        mock_build,
        slack_command_body,
        mock_slack_client,
        mock_logger,
        mock_context,
        mock_region_record,
    ):
        """Test that middleware calls build_backblast_form."""
        backblast.backblast_middleware(
            slack_command_body,
            mock_slack_client,
            mock_logger,
            mock_context,
            mock_region_record,
        )

        mock_build.assert_called_once()


@pytest.mark.unit
class TestBuildBackblastForm:
    """Tests for build_backblast_form function."""

    @patch("features.backblast.DbManager")
    def test_form_includes_required_fields(
        self,
        mock_db,
        slack_command_body,
        mock_slack_client,
        mock_logger,
        mock_context,
        mock_region_record,
    ):
        """Test that backblast form includes all required fields."""
        mock_db.find_records.return_value = []

        backblast.build_backblast_form(
            slack_command_body,
            mock_slack_client,
            mock_logger,
            mock_context,
            mock_region_record,
        )

        # Verify modal was opened
        mock_slack_client.views_open.assert_called_once()

        # Verify view structure contains required blocks
        call_args = mock_slack_client.views_open.call_args
        view = call_args[1]["view"]

        # Should have blocks for title, AO, date, Q, PAX, etc.
        assert "blocks" in view
        assert len(view["blocks"]) > 0

    # Add more tests for:
    # - Pre-filling from message context
    # - Loading AO list
    # - Custom fields
    # - Duplicate detection


@pytest.mark.unit
class TestHandleBackblastPost:
    """Tests for handle_backblast_post function."""

    @patch("features.backblast.DbManager")
    @patch("features.backblast.post_backblast_to_channel")
    def test_posts_to_channel(
        self,
        mock_post,
        mock_db,
        sample_view_submission,
        mock_slack_client,
        mock_logger,
        mock_context,
        mock_region_record,
    ):
        """Test that backblast is posted to channel."""
        # Setup view values
        sample_view_submission["view"]["state"]["values"] = {
            actions.BACKBLAST_TITLE: {
                actions.BACKBLAST_TITLE: {"value": "Test Workout"}
            },
            # Add more required fields...
        }

        mock_db.create_record.return_value = None

        backblast.handle_backblast_post(
            sample_view_submission,
            mock_slack_client,
            mock_logger,
            mock_context,
            mock_region_record,
        )

        # Verify post function was called
        mock_post.assert_called_once()

    # Add more tests for:
    # - Database record creation
    # - Email sending (if enabled)
    # - Error handling
    # - Validation failures
```

#### 3.3 Prioritize Features for Testing

**High Priority** (core user flows):

1. `features/backblast.py` - Critical user feature
2. `features/preblast.py` - Critical user feature
3. `features/calendar/home.py` - Main calendar interface
4. `features/config.py` - Settings management

**Medium Priority**: 5. `features/calendar/event_instance.py` 6. `features/calendar/event_type.py` 7. `features/calendar/ao.py` 8. `features/calendar/location.py`

**Lower Priority**: 9. `features/strava.py` - Optional integration 10. `features/weaselbot.py` - Achievement system 11. `features/custom_fields.py`

---

## Phase 4: Integration & Script Testing (3-4 hours)

### Objectives

- Test integration between components
- Test script automation jobs
- Test main.py routing flow

### Step-by-Step Instructions

#### 4.1 Create Integration Test Database

Add to `conftest.py`:

```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, scoped_session
from f3_data_models.models import Base


@pytest.fixture(scope="session")
def test_db_engine():
    """Create in-memory SQLite database for testing."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)


@pytest.fixture(scope="function")
def test_db_session(test_db_engine):
    """Create a new database session for a test."""
    Session = scoped_session(sessionmaker(bind=test_db_engine))
    session = Session()
    yield session
    session.rollback()
    session.close()
```

#### 4.2 Integration Tests

Create `test/integration/test_routing_integration.py`:

```python
"""Integration tests for routing and event handling."""
import pytest
from unittest.mock import patch, MagicMock
from main import main_response
from utilities.slack import actions


@pytest.mark.integration
class TestRoutingIntegration:
    """Test that events are properly routed to handlers."""

    @patch("features.backblast.build_backblast_form")
    def test_slash_command_routing(
        self,
        mock_handler,
        slack_command_body,
        mock_slack_client,
        mock_logger,
        mock_context,
    ):
        """Test that slash commands route correctly."""
        slack_command_body["command"] = "/backblast"
        ack = MagicMock()

        with patch("main.get_region_record") as mock_get_region:
            mock_get_region.return_value = MagicMock(team_id="T12345678")

            main_response(
                slack_command_body,
                mock_logger,
                mock_slack_client,
                ack,
                mock_context,
            )

        # Verify handler was called
        mock_handler.assert_called_once()
        ack.assert_called_once()

    @patch("features.calendar.event_tag.manage_event_tags")
    def test_button_action_routing(
        self,
        mock_handler,
        slack_action_body,
        mock_slack_client,
        mock_logger,
        mock_context,
    ):
        """Test that button actions route correctly."""
        slack_action_body["actions"][0]["action_id"] = actions.CALENDAR_MANAGE_EVENT_TAGS
        ack = MagicMock()

        with patch("main.get_region_record") as mock_get_region:
            mock_get_region.return_value = MagicMock(team_id="T12345678")

            main_response(
                slack_action_body,
                mock_logger,
                mock_slack_client,
                ack,
                mock_context,
            )

        mock_handler.assert_called_once()
```

#### 4.3 Script Testing

Create `test/unit/scripts/test_hourly_runner.py`:

```python
"""Tests for hourly_runner script."""
import pytest
from unittest.mock import patch, MagicMock
from scripts import hourly_runner


@pytest.mark.unit
class TestHourlyRunner:
    """Tests for run_all_hourly_scripts function."""

    @patch("scripts.hourly_runner.calendar_images.generate_calendar_images")
    @patch("scripts.hourly_runner.backblast_reminders.send_backblast_reminders")
    @patch("scripts.hourly_runner.preblast_reminders.send_preblast_reminders")
    def test_runs_all_scripts(
        self,
        mock_preblast,
        mock_backblast,
        mock_calendar,
    ):
        """Test that all hourly scripts are executed."""
        hourly_runner.run_all_hourly_scripts(run_reporting=False)

        mock_calendar.assert_called_once()
        mock_backblast.assert_called_once()
        mock_preblast.assert_called_once()

    @patch("scripts.hourly_runner.calendar_images.generate_calendar_images")
    def test_continues_on_script_failure(self, mock_calendar):
        """Test that script continues if one job fails."""
        mock_calendar.side_effect = Exception("Test error")

        # Should not raise exception
        hourly_runner.run_all_hourly_scripts(run_reporting=False)
```

---

## Phase 5: CI/CD Pipeline Setup (1-2 hours)

### Objectives

- Create GitHub Actions workflow
- Configure test running in CI
- Set up coverage reporting
- Add status badges

### Step-by-Step Instructions

#### 5.1 Create GitHub Actions Workflow

Create `.github/workflows/test.yml`:

```yaml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: f3_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install Poetry
        uses: snok/install-poetry@v1
        with:
          version: 1.7.1
          virtualenvs-create: true
          virtualenvs-in-project: true

      - name: Load cached venv
        id: cached-poetry-dependencies
        uses: actions/cache@v4
        with:
          path: .venv
          key: venv-${{ runner.os }}-${{ hashFiles('**/poetry.lock') }}

      - name: Install dependencies
        if: steps.cached-poetry-dependencies.outputs.cache-hit != 'true'
        run: poetry install --no-interaction --with test

      - name: Set up test environment
        env:
          DATABASE_HOST: localhost
          DATABASE_PORT: 5432
          DATABASE_USER: postgres
          DATABASE_PASSWORD: postgres
          DATABASE_NAME: f3_test
          LOCAL_DEVELOPMENT: true
          SLACK_SIGNING_SECRET: test-secret
          SLACK_BOT_TOKEN: xoxb-test-token
        run: |
          echo "DATABASE_HOST=localhost" >> .env
          echo "DATABASE_PORT=5432" >> .env
          echo "LOCAL_DEVELOPMENT=true" >> .env
          echo "SLACK_SIGNING_SECRET=test-secret" >> .env
          echo "SLACK_BOT_TOKEN=xoxb-test-token" >> .env

      - name: Run tests
        run: |
          poetry run pytest -v --cov --cov-report=xml --cov-report=term

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          file: ./coverage.xml
          flags: unittests
          name: codecov-umbrella
          fail_ci_if_error: false

      - name: Generate coverage badge
        if: github.ref == 'refs/heads/main'
        run: |
          poetry run coverage-badge -o coverage.svg -f

      - name: Upload coverage badge
        if: github.ref == 'refs/heads/main'
        uses: actions/upload-artifact@v4
        with:
          name: coverage-badge
          path: coverage.svg

  lint:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install Poetry
        uses: snok/install-poetry@v1

      - name: Install dependencies
        run: poetry install --no-interaction

      - name: Run Ruff
        run: poetry run ruff check .

      - name: Check formatting
        run: poetry run ruff format --check .
```

#### 5.2 Create Pre-commit Hook for Tests

Update `.pre-commit-config.yaml` (or create if doesn't exist):

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.8.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: local
    hooks:
      - id: pytest-check
        name: pytest-check
        entry: poetry run pytest -v --tb=short
        language: system
        pass_filenames: false
        always_run: true
        stages: [push]
```

#### 5.3 Add Coverage Badge to README

Add to `README.md`:

```markdown
[![Test Suite](https://github.com/F3-Nation/f3-nation-slack-bot/actions/workflows/test.yml/badge.svg)](https://github.com/F3-Nation/f3-nation-slack-bot/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/F3-Nation/f3-nation-slack-bot/branch/main/graph/badge.svg)](https://codecov.io/gh/F3-Nation/f3-nation-slack-bot)
```

---

## Phase 6: Maintenance & Best Practices (Ongoing)

### Testing Conventions

#### 1. Test Naming

- Test files: `test_<module_name>.py`
- Test classes: `Test<ClassName>`
- Test functions: `test_<what_it_tests>`
- Use descriptive names that explain what's being tested

#### 2. Test Structure (AAA Pattern)

```python
def test_something():
    # Arrange - Set up test data and mocks
    data = {"key": "value"}
    mock_service = MagicMock()

    # Act - Execute the code being tested
    result = function_under_test(data, mock_service)

    # Assert - Verify the results
    assert result == expected_value
    mock_service.method.assert_called_once()
```

#### 3. Test Markers

Use pytest markers to categorize tests:

```python
@pytest.mark.unit  # Fast, isolated unit tests
@pytest.mark.integration  # Tests with database/external dependencies
@pytest.mark.slow  # Tests that take >1 second
@pytest.mark.e2e  # End-to-end tests
```

Run specific test types:

```bash
poetry run pytest -m unit  # Only unit tests
poetry run pytest -m "not slow"  # Skip slow tests
```

#### 4. Mocking Strategy

- Mock external dependencies (database, Slack API, AWS, etc.)
- Don't mock the code you're testing
- Use `patch` as context manager or decorator
- Verify mock calls with `assert_called_once_with()`

#### 5. Test Data

- Use fixtures for reusable test data
- Use `faker` for realistic random data
- Keep test data minimal but representative

#### 6. Coverage Goals

- **Overall**: >70% coverage
- **Critical paths**: >90% coverage (routing, data processing)
- **Utilities**: >80% coverage
- **Don't chase 100%** - some code (error handlers, edge cases) is hard to test

#### 7. Running Tests Locally

```bash
# Run all tests
poetry run pytest

# Run specific test file
poetry run pytest test/unit/utilities/test_helper_functions.py

# Run specific test
poetry run pytest test/unit/utilities/test_helper_functions.py::TestSafeGet::test_nested_dict_access

# Run with coverage
poetry run pytest --cov

# Run fast tests only
poetry run pytest -m "not slow"

# Run with verbose output
poetry run pytest -v -s

# Run tests matching pattern
poetry run pytest -k "test_backblast"
```

---

## Success Criteria

### Phase Completion Checklist

**Phase 1 - Foundation**

- [ ] pytest installed and configured
- [ ] `conftest.py` with shared fixtures created
- [ ] `.coveragerc` and `pytest.ini` configured
- [ ] Existing tests migrated to pytest
- [ ] Tests run successfully locally

**Phase 2 - Core Utilities**

- [ ] Helper functions tested (>80% coverage)
- [ ] Routing logic tested
- [ ] Slack ORM tested
- [ ] All utility modules have test files

**Phase 3 - Features**

- [ ] Event tag tests comprehensive
- [ ] Backblast feature tested
- [ ] Preblast feature tested
- [ ] Calendar home tested
- [ ] High priority features >70% coverage

**Phase 4 - Integration**

- [ ] Routing integration tests created
- [ ] Script tests created
- [ ] Integration test database configured
- [ ] End-to-end test approach defined

**Phase 5 - CI/CD**

- [ ] GitHub Actions workflow created
- [ ] Tests run automatically on PRs
- [ ] Coverage reporting integrated
- [ ] Status badges added to README

**Phase 6 - Maintenance**

- [ ] Testing guidelines documented
- [ ] Team trained on testing approach
- [ ] Tests maintained with new features

---

## Estimated Timeline

| Phase                    | Time Estimate   | Priority    |
| ------------------------ | --------------- | ----------- |
| Phase 1: Foundation      | 2-3 hours       | Must have   |
| Phase 2: Core Utilities  | 3-4 hours       | Must have   |
| Phase 3: Feature Testing | 6-8 hours       | Must have   |
| Phase 4: Integration     | 3-4 hours       | Should have |
| Phase 5: CI/CD Pipeline  | 1-2 hours       | Must have   |
| Phase 6: Documentation   | 1 hour          | Should have |
| **Total**                | **16-22 hours** |             |

---

## Common Pitfalls & Solutions

### Pitfall 1: Over-mocking

**Problem**: Mocking so much that tests don't catch real bugs
**Solution**: Mock external dependencies only, test real logic

### Pitfall 2: Slow Tests

**Problem**: Tests take too long, developers skip them
**Solution**: Use in-memory database, mark slow tests, parallelize

### Pitfall 3: Flaky Tests

**Problem**: Tests pass/fail randomly
**Solution**: Avoid time-dependent tests, use `freezegun`, fix race conditions

### Pitfall 4: Testing Implementation, Not Behavior

**Problem**: Tests break when refactoring
**Solution**: Test public interfaces, not internal implementation

### Pitfall 5: No Test Maintenance

**Problem**: Tests become outdated and ignored
**Solution**: Treat tests as production code, update with features

---

## Next Steps

After completing this strategy:

1. **Start with Phase 1** - Get the foundation right
2. **Focus on high-value tests first** - Core features over edge cases
3. **Iterate and improve** - Add tests incrementally
4. **Measure progress** - Track coverage over time
5. **Make it a habit** - Write tests for all new features

**Ready to begin?** Start with Phase 1, Section 1.1: Install Testing Dependencies.
