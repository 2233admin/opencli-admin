FROM python:3.13-slim-bookworm AS builder

ARG UV_VERSION=0.10.8

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir "uv==${UV_VERSION}"

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project


FROM python:3.13-slim-bookworm AS runtime

ENV HOME=/tmp \
    PATH=/app/.venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    XDG_CACHE_HOME=/tmp/.cache

RUN addgroup --system graphon \
    && adduser --system --ingroup graphon --home /nonexistent graphon

WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY app.py contracts.py engine.py ./

USER graphon
EXPOSE 8095

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8095", "--no-access-log"]
