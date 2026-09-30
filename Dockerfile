# syntax = docker/dockerfile:1

# Plain Node running the TypeScript source directly (Node 24 strips types),
# so there's no build stage. Serves HTTP on 0.0.0.0:$PORT (fly.toml sets it);
# the SQLite file lives on the /data volume.

FROM docker.io/library/node:24.21.0-slim
WORKDIR /app
ENV NODE_ENV=production DB_PATH=/data/app.db
RUN npm install -g pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY src/ src/
COPY public/ public/
COPY README.md ./
COPY docs/ docs/
CMD ["node", "src/server.ts"]
