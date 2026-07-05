import base64
import json

from flask import Request, Response

from scripts import hourly_runner


def handle(request: Request) -> Response:
    decoded_data = request.data.decode()
    data_dict = json.loads(decoded_data)
    event_message = base64.b64decode(data_dict["message"]["data"]).decode()

    try:
        if event_message == "hourly":
            # Acknowledge immediately with 200 response
            import threading

            def run_scripts():
                # ...existing code...
                try:
                    hourly_runner.run_all_hourly_scripts()
                except Exception as e:
                    print(f"Error running hourly scripts: {e}")

            # Start scripts in background thread
            thread = threading.Thread(target=run_scripts)
            thread.daemon = True
            thread.start()

            return Response("Hourly scripts started", status=200)
        else:
            return Response(f"Event message not used: {event_message}", status=200)
    except Exception as e:
        print(f"Error running scripts: {e}")
        return Response(f"Error: {e}", status=200)
