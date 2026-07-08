FROM python:3.12-slim-bookworm
WORKDIR /app
COPY workers/odp-ingest-bridge/pyproject.toml ./worker/
COPY workers/odp-ingest-bridge/src ./worker/src/
COPY lib ./lib
RUN pip install --no-cache-dir -e ./worker
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
CMD ["python", "worker/src/main.py"]