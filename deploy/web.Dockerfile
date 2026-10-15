# syntax=docker/dockerfile:1
# Build context is the repository root (docker-compose.yml).

FROM node:24.21.0-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @spending/web
COPY apps/web apps/web
RUN pnpm --filter @spending/web build \
 && find apps/web/dist -name '*.map' -delete

FROM nginx:1.31.0-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY deploy/security-headers.conf /etc/nginx/security-headers.conf
COPY deploy/cloudflare-ips.conf /etc/nginx/cloudflare-ips.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
