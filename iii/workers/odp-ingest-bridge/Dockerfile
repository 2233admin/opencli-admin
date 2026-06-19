FROM python:3.12-slim-bookworm
WORKDIR /app
COPY workers/odp-ingest-bridge/pyproject.toml workers/odp-ingest-bridge/src ./worker/
COPY lib ./lib
RUN pip install --no-cache-dir -e ./worker
ENV PYTHONUNBUFFERED=1
CMD ["python", "worker/src/main.py"]