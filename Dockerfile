FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm --filter @tg/admin build

FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production DB_PATH=/data/gateway.db PORT=8787
VOLUME /data
EXPOSE 8787
CMD ["pnpm", "--filter", "@tg/server", "start"]
