FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 APP_HOME=/app
WORKDIR $APP_HOME

# Install system dependencies for Playwright/Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ca-certificates \
    gnupg \
    libglib2.0-0 \
    libgdk-pixbuf-2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libexpat1 \
    libdbus-1-3 \
    libx11-xcb1 \
    libxext6 \
    libxfixes3 \
    libxcb1 \
    libsm6 \
    libxtst6 \
    fonts-liberation \
    libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

RUN pip install --no-cache-dir playwright
RUN python -m playwright install chromium

COPY . ./

CMD ["python", "-m", "scripts.hourly_runner"]