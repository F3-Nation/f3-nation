# Overview

This package includes `sqlalchemy` ORM models that mirror those used by `drizzle` in `packages/db/drizzle`. These are utilized by `apps/slackbot` for db access management. However, we are in a slow transition to utilizing the F3 API for all db interactions in the app, and may eventually be able to deprecate this package.

> [!NOTE]
> This package used to be used to migrate the database; going forward, all migrations should be done via drizzle (with corresponding model changes here)

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
