# ---- stage 0: runtime dependencies ----
#
# Separate because `better-sqlite3` is native: when no prebuilt binary matches the
# platform it compiles here, which needs python3 and a C++ toolchain. Doing it in its own
# stage keeps the compiler out of the shipped image; installing it in the
# runtime stage is what made this Dockerfile unbuildable on Alpine.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY client/package.json client/
# Only the server's runtime dependencies; the client ships as static files.
RUN npm ci --omit=dev --workspace @cartograph/server --include-workspace-root \
    && npm cache clean --force

# ---- stage 1: build client + server ----
FROM node:22-alpine AS build
WORKDIR /app
# A full install pulls in `better-sqlite3` here too, and it compiles for the
# same reason as in the deps stage. Neither toolchain reaches the final image.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY packages/shared packages/shared
COPY server server
COPY client client
RUN npm run build

# ---- stage 2: runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app

# The port the container listens on. An ARG so EXPOSE and the healthcheck below
# cannot drift from it; compose passes the same number as PORT.
ARG APP_PORT=56321

ENV NODE_ENV=production \
    DATA_DIR=/data \
    CLIENT_DIR=/app/client/dist \
    PORT=${APP_PORT} \
    HOST=0.0.0.0

# Enough to work inside a running container without rebuilding it.
#
# "Files are the database" is the whole design, so the answer to most questions
# on a live box is to go and read one: `jq` for board.json, `sqlite3` for the
# accounts in app.db, `less` for a node.md, `curl` for the API. A few MB
# together, and their absence is what turns a five-second look into an
# afternoon of copying files off the host.
RUN apk add --no-cache bash curl less jq sqlite tini

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY client/package.json client/
# Already installed and compiled in the deps stage.
COPY --from=deps /app/node_modules node_modules

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
# Recovery and seeding run against a live instance. Without them, resetting a
# forgotten password would mean rebuilding the image to get one script in.
COPY scripts scripts
# The starter boards every new account gets. Real boards, captured — see
# scripts/make-template.mjs. Without them a new user opens an empty shelf.
COPY templates templates
ENV TEMPLATE_DIR=/app/templates/starter

# Fonts are bundled into client/dist by Vite — no external requests at runtime.
VOLUME ["/data"]
EXPOSE ${APP_PORT}

# The API is behind the session (v1.6 §2); the login page is what stays public,
# so `/` is the only thing that answers without a cookie.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" > /dev/null || exit 1

# tini as pid 1: Node is not an init. Without one, signals do not reach the app
# and a stop waits out the full timeout instead of shutting down when asked.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/dist/index.js"]
