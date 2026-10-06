# 固定版本；所有工作区依赖由同一个锁文件安装。
FROM node:24.19.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /source
# 依赖层只由工作区清单与锁文件决定，业务/文档变化复用安装结果。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/admin/package.json ./apps/admin/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/client-core/package.json ./packages/client-core/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/tsconfig/package.json ./packages/tsconfig/
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -r /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm install --global pnpm@11.28.4 && pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @weiban/server build && pnpm --filter @weiban/web build && pnpm --filter @weiban/admin build
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -r /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    pnpm --filter @weiban/server deploy --prod --legacy /runtime

FROM node:24.19.0-bookworm-slim AS app
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /runtime/ ./
RUN mkdir -p /app/.data/media && chown -R node:node /app/.data
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/health').then(async r=>{const h=await r.json();if(!r.ok||h.status!=='ok'||!h.checks.crypto.configured)process.exit(1)}).catch(()=>process.exit(1))"

FROM caddy:2.10.2-alpine AS edge
COPY deploy/prod/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /source/apps/web/dist/ /srv/web/
COPY --from=build /source/apps/admin/dist/ /srv/admin/
