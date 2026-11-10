FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752
WORKDIR /opt/weiban-server
COPY source/package.json source/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && \
    npm rebuild better-sqlite3
COPY source/db.js ./
COPY source/server.js ./
COPY source/lib ./lib
COPY source/routes ./routes
COPY source/public ./public
COPY source/persona_packages ./persona_packages
COPY retirement ./retirement
RUN mkdir -p /opt/weiban-server/runtime/admin_uploads && chown -R node:node /opt/weiban-server/runtime
USER node
CMD ["node", "retirement/archive-server.cjs"]
