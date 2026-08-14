# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

# 运行镜像：Node 同时提供静态前端、登录交换、持久卷和平台代理。
FROM node:22-alpine

WORKDIR /app
COPY --from=web-build /app/web/dist /app/web-dist
COPY server /app/server
RUN mkdir -p /data/infinite-canvas && chown -R node:node /app /data/infinite-canvas
USER node

EXPOSE 8080

ENV STATIC_DIR=/app/web-dist \
    CANVAS_DATA_DIR=/data/infinite-canvas \
    CANVAS_MAX_STORAGE_BYTES=30GB

VOLUME ["/data/infinite-canvas"]

CMD ["node", "/app/server/index.mjs"]
