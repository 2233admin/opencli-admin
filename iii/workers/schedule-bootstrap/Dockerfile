FROM python:3.13-slim
WORKDIR /app
COPY lib /app/lib
COPY schedules /app/schedules
COPY workers/schedule-bootstrap/pyproject.toml /app/workers/schedule-bootstrap/
COPY workers/schedule-bootstrap/src /app/workers/schedule-bootstrap/src/
RUN pip install --no-cache-dir -e ./workers/schedule-bootstrap
ENV DISCORD_SCHEDULES_PATH=/app/schedules/discord.yaml
ENV OPENCLI_SCHEDULES_PATH=/app/schedules/opencli.yaml
CMD ["python", "workers/schedule-bootstrap/src/main.py"]