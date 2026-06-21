import json
import logging
import os
import re
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Callable, Tuple

import functions_framework
from dotenv import load_dotenv
from flask import Request, Response
from google.cloud.logging_v2.handlers import StructuredLogHandler, setup_logging
from slack_bolt import Ack, App
from slack_bolt.adapter.google_cloud_functions import SlackRequestHandler
from slack_bolt.adapter.socket_mode import SocketModeHandler
from slack_sdk.web import WebClient

import scripts
from features import strava
from infrastructure.api_client.exceptions import (
    F3ApiAuthError,
    F3ApiError,
    F3ApiNotFoundError,
)
from utilities.builders import add_debug_form, add_loading_form, send_error_response
from utilities.constants import ENABLE_DEBUGGING, LOCAL_DEVELOPMENT, SOCKET_MODE
from utilities.database.orm import SlackSettings
from utilities.helper_functions import (
    get_oauth_settings,
    get_region_record,
    get_request_type,
    safe_get,
    update_local_region_records,
)
from utilities.routing import MAIN_MAPPER
from utilities.slack.actions import LOADING_ID


def setup_debugger():
    try:
        # Only ever enable debugger in local development
        if not (LOCAL_DEVELOPMENT and ENABLE_DEBUGGING):
            return

        import debugpy

        debugpy.listen(("0.0.0.0", 5678))
        print("Waiting for debugger attach on port 5678...")
        debugpy.wait_for_client()
    except Exception as exc:  # pragma: no cover - best-effort debug helper
        logging.getLogger().warning(f"Failed to initialize debugpy: {exc}")


setup_debugger()

load_dotenv()


def get_user_facing_error_message(exc: Exception) -> str:
    if isinstance(exc, F3ApiAuthError):
        return "The Slackbot could not authenticate with the F3 Nation API."
    if isinstance(exc, F3ApiNotFoundError):
        return "The requested F3 Nation resource could not be found."
    if isinstance(exc, F3ApiError):
        return (
            "Something went wrong while contacting the F3 Nation API. "
            "Please try again later."
        )
    return "Something went wrong. Please try again later."


process_before_response = os.environ.get("PROCESS_BEFORE_RESPONSE", "false").lower() == "true"
logging_level = logging.DEBUG if os.environ.get("LOG_LEVEL", "INFO").upper() == "DEBUG" else logging.INFO
if LOCAL_DEVELOPMENT:
    logger = logging.getLogger()
    logger.setLevel(logging_level)
    handler = logging.StreamHandler()
    logger.addHandler(handler)
else:
    handler = StructuredLogHandler()
    setup_logging(handler, log_level=logging_level)

try:
    app = App(
        process_before_response=process_before_response,
        oauth_settings=get_oauth_settings(),
    )
except Exception as exc:
    print(f"Error initializing Slackbot: you may need to set up your .env file with the appropriate Slack credentials. Exception: {exc}")

# ----------------------------------------
# Production Mode: Google Cloud Function HTTP Handler
# (DISABLED in local development)
# ----------------------------------------
if not LOCAL_DEVELOPMENT:

    @functions_framework.http
    def handler(request: Request):
        if request.path == "/":
            return Response("Service is running", status=200, headers={"Access-Control-Allow-Origin": "*"})
        elif request.path == "/gcp_event":
            logging.info("GCP Event")
            return scripts.handle(request)
        elif request.path == "/exchange_token":
            logging.info("Strava token exchange request")
            logging.info(f"Request query parameters: {request.args}")
            logging.info(f"Request headers: {request.headers}")
            logging.info(f"Request body: {request.get_data(as_text=True)}")
            return strava.strava_exchange_token(request)
        elif request.path[:6] == "/slack":
            slack_handler = SlackRequestHandler(app=app)
            return slack_handler.handle(request)
        elif request.path == "/hourly-runner-complete":
            update_local_region_records()
            return Response("Hourly runner completion endpoint", status=200)
        else:
            return Response(f"Invalid path: {request.path}", status=404)


def main_response(body: dict, logger: logging.Logger, client: WebClient, ack: Ack, context: dict):
    request_type, request_id = get_request_type(body)

    if LOCAL_DEVELOPMENT:
        logger.info(json.dumps(body, indent=4))
    else:
        logger.info(body)

    team_id = safe_get(body, "team_id") or safe_get(body, "team", "id")

    lookup: Tuple[Callable, bool] = safe_get(safe_get(MAIN_MAPPER, request_type), request_id)

    if lookup:
        run_function, add_loading = lookup
        if ENABLE_DEBUGGING and request_type != "view_submission":
            body[LOADING_ID] = add_debug_form(body=body, client=client)
            # NOTE: do not put debugging breakpoints above this line
        elif add_loading:
            body[LOADING_ID] = add_loading_form(body=body, client=client)

        if request_type != "block_suggestion":
            ack()

        try:
            try:
                region_record: SlackSettings = get_region_record(team_id, body, context, client, logger)
            except Exception as exc:
                logger.warning(f"Error getting region record: {exc}")
                region_record = SlackSettings(team_id=safe_get(body, "team_id") or safe_get(body, "team", "id"))
            # time the call
            start_time = time.time()
            resp = run_function(
                body=body,
                client=client,
                logger=logger,
                context=context,
                region_record=region_record,
            )
            if request_type == "block_suggestion":
                ack(options=resp if resp is not None else [])
            # elif request_type == "view_submission":
            #     update_submit_modal(
            #         client=client, logger=logger, text="Your data was saved successfully!"
            #     )  # TODO: handle errors
            end_time = time.time()
            logger.info(f"Function {run_function.__name__} took {end_time - start_time:.2f} seconds to run.")
        except Exception as exc:
            tb_str = "".join(traceback.format_exception(None, exc, exc.__traceback__))
            send_error_response(
                body=body,
                client=client,
                error=get_user_facing_error_message(exc),
            )
            if isinstance(exc, F3ApiError):
                logger.error(f"F3 API detail: {exc.detail}")
            logger.error(tb_str)
    else:
        ack()
        logger.warning(
            f"no handler for path: "
            f"{safe_get(safe_get(MAIN_MAPPER, request_type), request_id) or request_type + ', ' + request_id}"
        )

try:
    ARGS = [main_response]
    LAZY_KWARGS = {}

    MATCH_ALL_PATTERN = re.compile(".*")
    app.action(MATCH_ALL_PATTERN)(*ARGS, **LAZY_KWARGS)
    app.view(MATCH_ALL_PATTERN)(*ARGS, **LAZY_KWARGS)
    app.command(MATCH_ALL_PATTERN)(*ARGS, **LAZY_KWARGS)
    app.view_closed(MATCH_ALL_PATTERN)(*ARGS, **LAZY_KWARGS)
    app.event(MATCH_ALL_PATTERN)(*ARGS, **LAZY_KWARGS)
    app.options(MATCH_ALL_PATTERN)(*ARGS, **LAZY_KWARGS)
    app.shortcut(MATCH_ALL_PATTERN)(*ARGS, **LAZY_KWARGS)
except Exception as exc:
    pass


def start_local_health_server(port: int):
    class HealthHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"f3 slackbot local socket mode is running")

        # Keep local dev logs focused on bot activity.
        def log_message(self, fmt, *args):
            return

    server = HTTPServer(("0.0.0.0", port), HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server

if __name__ == "__main__":
    port = 8080
    local_http_port = int(os.environ.get("LOCAL_HTTP_PORT", "3006"))

    if LOCAL_DEVELOPMENT and not SOCKET_MODE:
        raise RuntimeError("Local development requires SOCKET_MODE=true.")
    
    # Ensure SLACK_APP_TOKEN is present
    app_token = os.environ.get("SLACK_APP_TOKEN")
    if not app_token:
        print("Error: SLACK_APP_TOKEN is required to run the Slackbot. Please set it in your .env file.")
        exit(1)

    if not SOCKET_MODE:
        try:
            app.start(port=port)
            update_local_region_records()
        except KeyboardInterrupt:
            # graceful shutdown during auto-reload
            pass
    else:
        if LOCAL_DEVELOPMENT:
            start_local_health_server(local_http_port)
            print(f"Local HTTP health server listening on http://localhost:{local_http_port}", flush=True)

        print("Running in local Socket Mode.", flush=True)

        handler = SocketModeHandler(app, app_token)
        handler.start()
