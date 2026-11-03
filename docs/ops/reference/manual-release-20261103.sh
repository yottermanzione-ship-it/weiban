#!/bin/bash
# 第 6 波：#48（回复封顶 4 条、确定性库错误不再空转、等待中回复定时补发 6 小时作废）。契约 5.2 不变，无迁移。部署后清理旧镜像与构建缓存。
set -euo pipefail
C=df822cb88a0bdc382e973c3c98b1acbce278031a
S=${C:0:8}
TREE=efbc1152d7d5f1f0814c64ef3039120fb1bec7ca
D=/srv/weiban/releases/$C
COMPOSE="docker compose -p weiban-prod --env-file /srv/weiban/runtime.env -f deploy/prod/compose.yml -f deploy/hk/compose.override.yml"

mkdir -p $D && tar -xzf /tmp/rel-$C.tgz -C $D && rm /tmp/rel-$C.tgz
cd $D
export APP_IMAGE=weiban-app:release-$C EDGE_IMAGE=weiban-edge:release-$C
$COMPOSE build app caddy
echo BUILD_OK

OLD=$(readlink -f /srv/weiban/src)
OLDC=$(basename $OLD)
OLDAPP=$(grep ^APP_IMAGE= /srv/weiban/runtime.env | cut -d= -f2)
OLDEDGE=$(grep ^EDGE_IMAGE= /srv/weiban/runtime.env | cut -d= -f2)
bash $D/deploy/hk/backup.sh /srv/weiban/backups
BK=$(ls -td /srv/weiban/backups/weiban-* | head -1)
echo BACKUP_OK $BK

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
pullRequest=48
contractVersion=5.2
migrations=none
rollbackImages=weiban-app:before-$S,weiban-edge:before-$S
previousSource=/srv/weiban/src.before-$S
deployedBy=claude (wave 6: reply bubble cap 4, deterministic db errors no retry, waiting sweep 6h)
V
docker exec weiban-prod-app-1 node -e 'fetch("http://127.0.0.1:3000/health").then(r=>r.text()).then(console.log)'
echo DEPLOY_OK
# 11-03 数据盘写满事故后加：只留当前版本、上一版（回滚）与 hk 标签，其余旧镜像和构建缓存清掉。
KEEP_TAGS="weiban-app:release-$C weiban-edge:release-$C $OLDAPP $OLDEDGE weiban-app:before-$S weiban-edge:before-$S weiban-app:hk weiban-edge:hk"
for t in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^weiban-(app|edge):'); do
  case " $KEEP_TAGS " in *" $t "*) ;; *) docker rmi "$t" >/dev/null 2>&1 || true ;; esac
done
docker builder prune -f >/dev/null 2>&1 || true
df -h /srv/weiban | tail -1
echo CLEANUP_OK
