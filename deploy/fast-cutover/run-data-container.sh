#!/usr/bin/env bash
# Called inside one live agent-forwarded SSH session. Does not stop, restart, or deploy services.
set -euo pipefail
umask 077
[[ $# == 7 ]] || { echo 'FAST_DATA_ARGUMENTS_REQUIRED' >&2; exit 2; }
mode=$1 image=$2 tools_dir=$3 metadata_dir=$4 cutoff=$5 freeze_id=$6 target_oid=$7
[[ $mode == plan || $mode == execute ]] || exit 2
[[ $image =~ ^weiban-app:release-[a-f0-9]{8,40}$ ]] || exit 2
[[ $tools_dir == /tmp/wb-fast-1109/tools && $metadata_dir == /tmp/wb-fast-1109/metadata ]] || exit 2
[[ $cutoff =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$ ]] || exit 2
[[ $freeze_id =~ ^[A-Za-z0-9_-]{6,80}$ && $target_oid =~ ^[0-9]+$ ]] || exit 2
[[ -S ${SSH_AUTH_SOCK:-} && -r $metadata_dir/known_hosts && -r $metadata_dir/ssh-settings.json && -r $tools_dir/fast-cutover-transport.mjs ]] || exit 2
docker image inspect "$image" >/dev/null
if [[ $mode == execute ]]; then
  [[ $(docker inspect --format '{{.State.Running}}' weiban-prod-app-1) == false ]] || { echo 'FAST_TARGET_APP_NOT_STOPPED' >&2; exit 2; }
fi
socket_owner=$(stat -c '%u:%g' "$SSH_AUTH_SOCK")
restore_socket_owner() { chown "$socket_owner" "$SSH_AUTH_SOCK" 2>/dev/null || true; }
trap restore_socket_owner EXIT
# Only this session's temporary forwarded socket; never a private key or the user's key directory.
chown 1000:1000 "$SSH_AUTH_SOCK"
source /srv/weiban/src/deploy/hk/ops-lib.sh
export APP_IMAGE=$image
"${weiban_compose[@]}" run --rm --no-deps -T --name weiban-fast-cutover-1109 \
  --volume "$tools_dir:/app/fast-cutover:ro" \
  --volume "$metadata_dir:/run/wb-fast:ro" \
  --volume "$SSH_AUTH_SOCK:/run/wb-fast-agent.sock:ro" \
  --entrypoint node app /app/fast-cutover/fast-cutover-transport.mjs \
  "--$mode" --settings /run/wb-fast/ssh-settings.json --cutoff "$cutoff" \
  --freeze-id "$freeze_id" --expected-database weiban --expected-oid "$target_oid" \
  --rounding ceil --benefit-cutover-at "$cutoff"
