# Overview

This repository defines the F3 data structure, used by the F3 Slack Bot, Maps, etc. The projected uses SQLAlchemy to define the tables / models.

# Running Locally

To load the data structure in your database:

1. Set up a local db, update `.env.example` and save as `.env`
2. Clone the repo, use Poetry to install dependencies:

```sh
poetry env use 3.12
poetry install
```

3. Run the alembic migration:

```sh
source .env && poetry run alembic upgrade head
```

# Optional BigQuery Sessions

The default database session path is PostgreSQL. To explicitly request a BigQuery session, pass the optional `backend` argument:

```python
from f3_data_models.utils import get_session

postgres_session = get_session()
bigquery_session = get_session(backend="bigquery")
```

`session_scope(...)` and `DbManager` methods also accept the same optional `backend` argument.

BigQuery mode requires these environment variables:

- `BIGQUERY_PROJECT`
- `BIGQUERY_DATASET`

Authentication should be provided through Google Application Default Credentials in the runtime environment.

# Entity Overview

```mermaid
---
config:
    look: handDrawn
    theme: dark
---

erDiagram
    USERS ||--|{ ATTENDANCE : have
    ATTENDANCE }|--|| EVENT_INSTANCES: at
    ATTENDANCE }|..|{ ATTENDANCE_TYPES : "are of type(s)"
    EVENT_INSTANCES }|..|| EVENTS : "part of series"
    EVENT_INSTANCES }|..|{ EVENT_TYPES : "with type(s)"
    EVENTS }|..|{ EVENT_TYPES : "with type(s)"
    EVENT_INSTANCES }|--|| ORGS : "belong to"
    EVENT_INSTANCES }|..|| LOCATIONS : "at"
    EVENTS }|--|| ORGS : "belong to"
    EVENTS }|..|| LOCATIONS : "at"
    SLACK_SPACES ||..|| ORGS : "are connected to"
    USERS ||..|{ SLACK_USERS : "have one or more"
    SLACK_USERS }|--|| SLACK_SPACES : "belong to"
    USERS }|..|{ ACHIEVEMENTS : "earn"
    USERS }|..|{ ROLES : "have"
    ROLES ||..|{ PERMISSIONS : "have"
    ROLES }|..|{ ORGS : "in"
    USERS }|..|{ POSITIONS : "hold"
    POSITIONS }|..|{ ORGS : "in"
```
