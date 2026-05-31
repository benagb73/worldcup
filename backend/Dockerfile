# Python 3.11 is the latest version with reliable libsql-client wheels on Linux.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies in their own layer so they cache between code changes
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY app ./app
COPY schema.sql .
COPY scripts ./scripts

EXPOSE 8000

# Fly.io's [http_service] expects the app to listen on 0.0.0.0:8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
