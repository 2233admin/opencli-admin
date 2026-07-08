FROM python:3.13-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @jackwener/opencli

COPY workers/collector-opencli/pyproject.toml ./worker/
COPY workers/collector-opencli/src ./worker/src/
COPY lib ./lib
RUN pip install --no-cache-dir -e ./worker

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV OPENCLI_BIN=opencli
ENV OPENCLI_MODE=bridge
ENV OPENCLI_DAEMON_HOST=agent-1
ENV OPENCLI_DAEMON_PORT=19825

CMD ["python", "worker/src/main.py"]