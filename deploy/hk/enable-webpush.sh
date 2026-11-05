#!/usr/bin/env bash
# Called after a checked image build and before the normal release switch. No restart here.
set -euo pipefail
umask 077
[[ ${1:-} == --prepare ]] || { echo 'Use --prepare SOURCE_ROOT COMMIT' >&2; exit 2; }
source_root=${2:?source root required}
commit=${3:?full commit required}
[[ $(id -u) == 0 ]] || { echo 'root required for protected push configuration' >&2; exit 1; }
runtime=${WEIBAN_DEPLOY_ENV:-/srv/weiban/runtime.env}
secret_dir=/srv/weiban/keys/web-push
ops_root=${WEIBAN_OPS_ROOT:-/srv/weiban/ops}
image=${PUSH_APP_IMAGE:?checked application image required}
[[ -f $runtime && -r $runtime && ! -L $runtime && ! -L $secret_dir ]] || exit 1
[[ $commit =~ ^[0-9a-f]{40}$ ]] || exit 2
configured=$(sed -n 's/^PUSH_CREDENTIALS_PATH=//p' "$runtime" | tail -n 1 | tr -d "\"'\r")
[[ -z $configured || $configured == "$secret_dir/credentials.json" ]] || {
  echo 'Existing push credential path differs; refusing implicit replacement' >&2
  exit 1
}
# Share the backup lock: a timer must not race the configuration/operations switch.
command -v flock >/dev/null
exec 9>"${BACKUP_LOCK_FILE:-/run/lock/weiban-backup.lock}"
flock -n 9 || { echo 'A backup or push preparation is running; retry later' >&2; exit 1; }
if systemctl is-active --quiet weiban-backup.service; then
  echo 'A backup is running; retry after it finishes' >&2
  exit 1
fi
install -d -m 0700 -o 0 -g 0 -- "$secret_dir"
# The private key never reaches the caller's stdout, repository or environment.
# A named script path is used so import.meta's entry guard runs under node.
docker run --rm --network none --user 0:0 --read-only --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE \
  --mount "type=bind,src=$secret_dir,dst=/secrets" \
  --mount "type=bind,src=$source_root/deploy/hk/provision-webpush.mjs,dst=/provision-webpush.mjs,readonly" \
  --entrypoint node "$image" /provision-webpush.mjs --write /secrets/credentials.json https://weiban.online
bash "$source_root/deploy/hk/install-ops-runtime.sh" "$source_root" "$commit"
for service in backup disk-check; do
  directory=/etc/systemd/system/weiban-$service.service.d
  install -d -m 0755 -- "$directory"
  suffix=
  [[ $service != backup ]] || suffix=' /var/backups/weiban'
  printf '[Service]\nExecStart=\nExecStart=/bin/bash %s/current/%s.sh%s\n' "$ops_root" "$service" "$suffix" >"$directory/webpush-runtime.conf"
  chmod 0644 "$directory/webpush-runtime.conf"
done
temporary=$(mktemp "$runtime.push.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
sed '/^PUSH_CREDENTIALS_PATH=/d' "$runtime" >"$temporary"
printf '\nPUSH_CREDENTIALS_PATH=%s/credentials.json\n' "$secret_dir" >>"$temporary"
chmod --reference="$runtime" "$temporary"
chown --reference="$runtime" "$temporary"
mv -f -- "$temporary" "$runtime"
systemctl daemon-reload
echo 'Push configuration prepared; the normal release switch will activate it.'
