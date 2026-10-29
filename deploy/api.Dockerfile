# syntax=docker/dockerfile:1
# Build context is the repository root (docker-compose.yml).

FROM node:24.22.0-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @spending/api
COPY apps/api apps/api
RUN pnpm --filter @spending/api build \
 && pnpm --filter @spending/api deploy --prod --legacy /out

FROM node:24.22.0-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
