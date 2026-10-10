FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

ARG VITE_API_BASE_URL=/api/v1/workbench
ARG VITE_PLANNING_YEAR=2027
ARG VITE_YIWEN_IFRAME_URL=

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_PLANNING_YEAR=${VITE_PLANNING_YEAR} \
    VITE_YIWEN_IFRAME_URL=${VITE_YIWEN_IFRAME_URL}

RUN npm run build


FROM python:3.11-slim-bookworm AS runtime

ARG APP_REVISION=unknown

LABEL org.opencontainers.image.title="shell-forecast" \
      org.opencontainers.image.revision="${APP_REVISION}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app/backend

RUN sed -i \
        -e 's|http://deb.debian.org/debian|https://mirrors.aliyun.com/debian|g' \
        -e 's|http://deb.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
        /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /nonexistent --shell /usr/sbin/nologin app

COPY backend/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir \
    --index-url http://mirrors.cloud.aliyuncs.com/pypi/simple/ \
    --trusted-host mirrors.cloud.aliyuncs.com \
    -r requirements.txt

COPY --chown=app:app backend/src ./src
COPY --chown=app:app backend/migrations ./migrations
COPY --chown=app:app backend/alembic.ini ./alembic.ini
COPY --chown=app:app backend/scripts ./scripts
COPY --chown=app:app backend/docs ./docs
COPY --chown=app:app backend/insight_capabilities ./insight_capabilities
COPY --from=frontend-builder --chown=app:app /build/frontend/dist /app/frontend/dist

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).read()"]

CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
