import os

# Force deterministic values for env-driven feature flags before any app module
# (e.g. utilities.constants) loads the developer's local .env, so test outcomes
# don't depend on ambient dev settings like ENABLE_DEBUGGING=true.
os.environ["ENABLE_DEBUGGING"] = "false"
os.environ["LOCAL_DEVELOPMENT"] = "true"
os.environ["SLACK_BOT_TOKEN"] = "test-token"
