# F3 Nation Slack Bot - AI Coding Agent Guide

## Architecture Overview

This is a **Slack Bolt Python app** deployed to Google Cloud Run that manages F3 fitness community operations. The app uses an **event-driven routing architecture** where all Slack interactions flow through a single entrypoint (`main.py`) and are dispatched to feature modules via `utilities/routing.py`.

**Key architectural pattern**: Slack events → `main_response()` → routing lookup → feature handler (build/handle functions)

### Data Flow

1. Slack sends event to `/slack` endpoint (handled by `@functions_framework.http`)
2. `main_response()` extracts request type and ID via `get_request_type()`
3. `MAIN_MAPPER` in `utilities/routing.py` routes to appropriate feature function
4. Functions receive standard signature: `(body, client, logger, context, region_record)`
5. Feature functions build/update Slack modals or handle form submissions

## Critical Development Workflows

### Local Development Setup

```bash
# Use VS Code Dev Containers (recommended)
# 1. Ensure Docker and Dev Container extension installed
# 2. Open folder in container (auto-builds db, db-init, app services)

# Start the app
./app_startup.sh  # Starts localtunnel + watchfiles auto-reload

# App runs on http://localhost:3000
# Localtunnel provides public URL (saved to .env as LT_SUBDOMAIN_SUFFIX)
```

**Important**: `app_startup.sh` auto-generates `app_manifest.json` from `app_manifest.template.json` with the localtunnel URL. Update your Slack app manifest via the web console after starting.

### Database Architecture

- Uses **SQLAlchemy** with models from external package `f3-data-models` (version ^0.8.0)
- Access via `DbManager` from `f3_data_models.utils`
- Two ORMs in play:
  - `utilities/database/orm/__init__.py` - defines `SlackSettings` dataclass
  - `f3-data-models` package - defines main models (Org, User, EventTag, etc.)
- PostgreSQL runs on `localhost:5433` (mapped from container port 5432)
- Migrations handled by `db-init` service which clones F3-Data-Models repo and runs Alembic

**Pattern**: Always use `DbManager.get()`, `DbManager.find_records()`, `DbManager.create_record()`, etc. Never raw SQL.

### Testing & Code Quality

```bash
# Managed by poetry + pre-commit hooks
poetry install                    # Install dependencies
poetry export -f requirements.txt -o requirements.txt --without-hashes  # Sync requirements.txt after adding packages

# Linting with Ruff (line-length: 120)
# Pre-commit hooks auto-run on commit
# isort orders: future → standard-library → third-party → first-party → local-folder
```

## Project-Specific Patterns

### Routing Pattern

Every new Slack interaction **must** be registered in `utilities/routing.py`:

```python
ACTION_MAPPER = {
    actions.CALENDAR_MANAGE_EVENT_TAGS: (event_tag.manage_event_tags, False),
    # Format: "action_id": (handler_function, show_loading_modal)
}
```

The boolean flag controls whether a loading modal appears before the handler runs.

**Action ID constants** live in `utilities/slack/actions.py` - centralized string constants prevent typos.

### Feature Module Design Pattern

**Modern pattern** (see `features/calendar/event_tag.py`):

1. **Service class** - business logic (e.g., `EventTagService`)
2. **Views class** - Slack UI construction (e.g., `EventTagViews`)
3. **Handler functions** - orchestrate service + views, registered in routing
4. **Module-level constants** for action IDs

**Legacy pattern** (older modules): Build functions, handle functions, and UI mixed in single file. Refactor new code to modern pattern.

### Slack UI Construction

**Two approaches coexist**:

1. **Legacy custom ORM** (`utilities/slack/orm.py`): Custom `InputBlock`, `BaseElement` classes with `.as_form_field()` method
   - Used in older features
   - Eventually being phased out

2. **Slack SDK ORM** (`utilities/slack/sdk_orm.py`): Uses `slack_sdk.models.blocks` directly
   - Preferred for new code (see `features/calendar/event_tag.py`)
   - Wrapper class `SdkBlockView` provides helpers like `set_initial_values()`, `get_selected_value()`
   - Helper function `as_selector_options()` converts lists to Slack Option objects

**Pattern**: Use `SdkBlockView` for new features, gradually migrate legacy ORM usage.

### Helper Functions & Utilities

**Critical utilities in `utilities/helper_functions.py`**:

- `safe_get(data, *keys)` - nested dict access without KeyErrors (handles dicts, lists, SlackResponse, SQLAlchemy Rows)
- `get_region_record(team_id, ...)` - fetches `SlackSettings` for a workspace
- `REGION_RECORDS` - in-memory cache of SlackSettings by team_id
- `update_local_region_records()` - refreshes cache (called by hourly runner)

### Scripts & Automation

**Hourly jobs** in `scripts/`:

- Entrypoint: `scripts/hourly_runner.py` - runs all scheduled tasks
- Separate Docker image (see `scripts/Dockerfile`) with heavy deps (Playwright, pandas, plotting libs)
- Deployed as Cloud Run Job
- Calls back to main app via `/hourly-runner-complete` webhook

**Key scripts**:

- `calendar_images.py` - generates calendar visuals
- `backblast_reminders.py` / `preblast_reminders.py` - sends reminders
- `q_lineups.py` - Q assignment notifications
- `monthly_reporting.py` - analytics reports

## External Dependencies & Integration

### F3 Data Models Package

External package managing database schema. Located at: `https://github.com/F3-Nation/F3-Data-Models`

**Key models**: Org, User, EventTag, EventType, EventInstance, AO, Location, SlackUser, SlackSpace

**Important**: Future architecture will use an API instead of direct DB access. Design for this transition.

### Slack Integration

- Uses `slack-bolt` 1.22.0 with `SlackRequestHandler` adapter for Flask/Functions Framework
- OAuth handled by `FileInstallationStore` (mounted volume in production)
- `process_before_response=True` in production for faster ack

### Environment Configuration

Required variables in `.env`:

- `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN` (from Slack app console)
- `LOCAL_DEVELOPMENT=true` (disables Cloud Logging, OAuth)
- `DATABASE_HOST=db` (container networking)
- `LT_SUBDOMAIN_SUFFIX` (auto-generated, persistent subdomain for localtunnel)

## Common Pitfalls

1. **Adding new actions**: Always add constant to `utilities/slack/actions.py` + register in `utilities/routing.py` mapper
2. **Poetry vs requirements.txt**: After `poetry add`, must manually run export command to sync `requirements.txt`
3. **Database port**: Use `5433` externally (5432 is container internal)
4. **Loading modals**: Set boolean flag in routing mapper to show/hide loading indicator
5. **Form submissions**: Use `SdkBlockView.get_selected_values()` to extract form data from submission body
6. **Region context**: Most handlers need `region_record` for org_id and workspace settings

## File Organization

- `features/` - core functionality (backblast, preblast, calendar, config, etc.)
- `features/calendar/` - calendar-specific features (modular design)
- `utilities/` - shared helpers, routing, builders, constants
- `utilities/slack/` - Slack-specific abstractions (actions, forms, ORM)
- `utilities/database/` - DB utilities and ORM definitions
- `scripts/` - scheduled jobs (separate deployment)
- `test/` - pytest tests (limited coverage currently)

## Future Considerations

- **API migration**: Direct DB access will be replaced by API calls
- **Full ORM migration**: Move all code to use `slack_sdk.models` directly
- **Testing**: Expand test coverage, especially for critical feature paths
- **Modularization**: Refactor legacy features to Service/Views/Handler pattern
