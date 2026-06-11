FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 APP_HOME=/app GOOGLE_FUNCTION_TARGET=handler
WORKDIR $APP_HOME

COPY . ./
RUN pip install --no-cache-dir .
EXPOSE 8080
CMD ["functions-framework", "--target", "handler", "--port", "8080"]