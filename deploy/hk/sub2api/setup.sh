#!/usr/bin/env bash
# 在香港服务器初始化 sub2api 运行目录（可重复执行，不覆盖已有秘密）。root 运行。
set -euo pipefail
umask 077
SRC=${WEIBAN_SRC:-/srv/weiban/src}
DIR=/srv/weiban/sub2api
install -d -m 0700 "$DIR"
install -d -m 0700 "$DIR/data" "$DIR/postgres_data" "$DIR/redis_data"
cp "$SRC/deploy/hk/sub2api/compose.yml" "$DIR/compose.yml"
if [[ ! -s "$DIR/.env" ]]; then
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
    echo "REDIS_PASSWORD=$(openssl rand -hex 32)"
    echo "JWT_SECRET=$(openssl rand -hex 32)"
    echo "TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)"
    echo "ADMIN_EMAIL=ops-$(openssl rand -hex 4)@weiban-admin.example.com"
    echo "ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
  } > "$DIR/.env"
fi
chmod 600 "$DIR/.env"
# 给总经理看的管理员登录资料（只含邮箱和密码），root 600
grep -E '^ADMIN_(EMAIL|PASSWORD)=' "$DIR/.env" > /srv/weiban/secrets/sub2api-admin.txt
chmod 600 /srv/weiban/secrets/sub2api-admin.txt
docker network inspect weiban-llm >/dev/null 2>&1 || docker network create --internal weiban-llm >/dev/null
cd "$DIR" && docker compose -p sub2api up -d --wait
