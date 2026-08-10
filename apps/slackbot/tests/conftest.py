import os

# Force deterministic values for env-driven feature flags before any app module
# (e.g. utilities.constants) loads the developer's local .env, so test outcomes
# don't depend on ambient dev settings like ENABLE_DEBUGGING=true.
os.environ.setdefault("ENABLE_DEBUGGING", "false")
