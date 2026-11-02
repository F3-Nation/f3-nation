import os

# Force deterministic values for env-driven feature flags before any app module
# (e.g. utilities.constants) loads the developer's local .env, so test outcomes
# don't depend on ambient dev settings like ENABLE_DEBUGGING=true.
os.environ["ENABLE_DEBUGGING"] = "false"
# An empty value keeps dotenv from loading the local GCS_EMULATOR_HOST, so storage
# tests use the /mnt path unless they set the emulator host themselves.
os.environ["GCS_EMULATOR_HOST"] = ""
