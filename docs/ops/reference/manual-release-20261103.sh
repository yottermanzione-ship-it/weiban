#!/bin/bash
# 第 7 波：#50（磁盘与备份脚本入库，服务器步骤另行执行）+ #51（私聊按素材分享照片、群聊表情包）。契约 5.2 不变，无迁移。
# 按总经理 11-03 规则：不含迁移不做发版前备份，要求 24 小时内有完整备份；镜像只留当前 + 2 个可回退版本（另留 :hk）。
set -euo pipefail
C=2e3ebc7ce933e8bbe685f2ba19e5d9cb97aa8cf2
S=${C:0:8}
TREE=2ee1a344d63b322e50ab15cbc46f56941700dacc
D=/srv/weiban/releases/$C
COMPOSE="docker compose -p weiban-prod --env-file /srv/weiban/runtime.env -f deploy/prod/compose.yml -f deploy/hk/compose.override.yml"

mkdir -p $D && tar -xzf /tmp/rel-$C.tgz -C $D && rm /tmp/rel-$C.tgz
cd $D
OLD=$(readlink -f /srv/weiban/src)
OLDC=$(basename $OLD)
if ! diff -q $OLD/apps/server/drizzle/meta/_journal.json $D/apps/server/drizzle/meta/_journal.json >/dev/null; then
  echo "MIGRATION_DETECTED: 本脚本按无迁移编写，停止"; exit 1
fi
BK=$(find /var/backups/weiban /srv/weiban/backups -maxdepth 2 -name manifest.txt -path '*/weiban-*' -mmin -1440 -printf '%T@ %h\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2)
if [ -z "$BK" ]; then
  echo "24 小时内没有完整备份，先备份到系统盘"
  bash $D/deploy/hk/backup.sh /var/backups/weiban
  BK=$(ls -td /var/backups/weiban/weiban-* | head -1)
fi
echo BACKUP_REF $BK

export APP_IMAGE=weiban-app:release-$C EDGE_IMAGE=weiban-edge:release-$C
$COMPOSE build app caddy
echo BUILD_OK

OLDAPP=$(grep ^APP_IMAGE= /srv/weiban/runtime.env | cut -d= -f2)
OLDEDGE=$(grep ^EDGE_IMAGE= /srv/weiban/runtime.env | cut -d= -f2)
PREVC=$(grep ^previousSourceCommit= /srv/weiban/deployment-version.txt | cut -d= -f2)
docker tag $OLDAPP weiban-app:before-$S
docker tag $OLDEDGE weiban-edge:before-$S
ln -sfn $OLD /srv/weiban/src.before-$S
cp /srv/weiban/runtime.env /srv/weiban/release-state/runtime.env.before-$C
sed -i "s#^APP_IMAGE=.*#APP_IMAGE=$APP_IMAGE#; s#^EDGE_IMAGE=.*#EDGE_IMAGE=$EDGE_IMAGE#" /srv/weiban/runtime.env
ln -sfn $D /srv/weiban/src
cd /srv/weiban/src
$COMPOSE up -d --wait app caddy

cat > /srv/weiban/deployment-version.txt <<V
sourceCommit=$C
sourceTree=$TREE
deployedAt=$(date -u +%FT%TZ)
appImage=$APP_IMAGE
edgeImage=$EDGE_IMAGE
appImageId=$(docker image inspect -f '{{.Id}}' $APP_IMAGE)
edgeImageId=$(docker image inspect -f '{{.Id}}' $EDGE_IMAGE)
previousSourceCommit=$OLDC
backupDir=$BK
pullRequest=50,51
contractVersion=5.2
migrations=none
rollbackImages=weiban-app:before-$S,weiban-edge:before-$S
previousSource=/srv/weiban/src.before-$S
deployedBy=claude (wave 7: chat photos from material, group stickers, disk-safety scripts; no pre-deploy backup per 11-03 rule)
V
docker exec weiban-prod-app-1 node -e 'fetch("http://127.0.0.1:3000/health").then(r=>r.text()).then(console.log)'
echo DEPLOY_OK
# 保留：当前版本、上一版（$OLDAPP = before-$S）、上上一版（before-${OLDC:0:8} = release-$PREVC）、:hk。
KEEP_TAGS="weiban-app:release-$C weiban-edge:release-$C $OLDAPP $OLDEDGE weiban-app:before-$S weiban-edge:before-$S weiban-app:before-${OLDC:0:8} weiban-edge:before-${OLDC:0:8} weiban-app:release-$PREVC weiban-edge:release-$PREVC weiban-app:hk weiban-edge:hk"
for t in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^weiban-(app|edge):'); do
  case " $KEEP_TAGS " in *" $t "*) ;; *) docker rmi "$t" >/dev/null 2>&1 || true ;; esac
done
docker builder prune -f >/dev/null 2>&1 || true
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -E '^weiban-'
df -h /srv/weiban / | tail -2
echo CLEANUP_OK
