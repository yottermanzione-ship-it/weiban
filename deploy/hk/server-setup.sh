#!/usr/bin/env bash
# 香港服务器初始化（Ubuntu 24.04，root 运行，可重复执行）。
# 做的事：挂载数据盘到 /srv/weiban、安装 Docker 官方版（data-root 在数据盘）、安全更新、ufw、fail2ban。
# 不做的事：不改 SSH 端口、不禁用密码登录、不改 root 密码（须总经理另行同意）。
#
# 数据盘规则：
#   - DATA_PART（默认 /dev/vdb1）已有 ext4 → 不格式化，直接按 UUID 挂载。
#   - 整块盘 DATA_DISK（默认 /dev/vdb）完全没有分区表和文件系统，且显式 FORMAT_EMPTY_DISK=1 → 建分区并格式化。
#   - 其他情况一律停止，不动盘。
set -euo pipefail
DATA_DISK=${DATA_DISK:-/dev/vdb}
DATA_PART=${DATA_PART:-${DATA_DISK}1}
MOUNT_POINT=/srv/weiban

if ! mountpoint -q "$MOUNT_POINT"; then
  if [[ -b "$DATA_PART" && "$(blkid -o value -s TYPE "$DATA_PART" || true)" == ext4 ]]; then
    echo "数据盘分区 $DATA_PART 已是 ext4，不格式化，直接挂载。"
  elif [[ -z "$(blkid -p "$DATA_DISK" 2>/dev/null || true)" && -z "$(lsblk -no NAME "$DATA_DISK" | tail -n +2)" && "${FORMAT_EMPTY_DISK:-0}" == 1 ]]; then
    echo "数据盘 $DATA_DISK 为空，按显式要求建分区并格式化。"
    parted -s "$DATA_DISK" mklabel gpt mkpart weiban ext4 1MiB 100%
    udevadm settle
    mkfs.ext4 -L weiban-data "$DATA_PART"
  else
    echo "数据盘状态不符合预期（不是空盘也不是 ext4 分区），停止，不做任何改动。" >&2
    exit 1
  fi
  uuid=$(blkid -o value -s UUID "$DATA_PART")
  mkdir -p "$MOUNT_POINT"
  grep -q "$uuid" /etc/fstab || echo "UUID=$uuid $MOUNT_POINT ext4 defaults,nofail 0 2" >> /etc/fstab
  systemctl daemon-reload
  mount "$MOUNT_POINT"
fi
install -d -m 0755 "$MOUNT_POINT"
install -d -m 0700 "$MOUNT_POINT/secrets" "$MOUNT_POINT/backups" "$MOUNT_POINT/keys"
install -d -m 0711 "$MOUNT_POINT/docker"

export DEBIAN_FRONTEND=noninteractive
APT="apt-get -o DPkg::Lock::Timeout=900"
$APT update -q
$APT install -y -q ca-certificates curl gnupg ufw fail2ban unattended-upgrades age
unattended-upgrade -v || true

# Docker 官方 apt 源
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  $APT update -q
fi
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<JSON
{
  "data-root": "$MOUNT_POINT/docker",
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
JSON
$APT install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
# Docker 29 默认用 containerd 镜像存储，镜像层在 containerd 的 root 下而非 data-root，一并放数据盘。
if ! grep -q '^root *=' /etc/containerd/config.toml 2>/dev/null; then
  systemctl stop docker.socket docker containerd || true
  install -d -m 0711 "$MOUNT_POINT/containerd"
  if [[ -d /var/lib/containerd ]]; then cp -a /var/lib/containerd/. "$MOUNT_POINT/containerd/"; mv /var/lib/containerd /var/lib/containerd.old; fi
  sed -i "1i root = \"$MOUNT_POINT/containerd\"" /etc/containerd/config.toml
  systemctl start containerd
fi
systemctl enable --now docker
systemctl restart docker

# 防火墙：只放行 22、80。443 预留，有域名/证书后再开（ufw allow 443/tcp）。
# 注意：Docker 发布的端口会绕过 ufw，所以后台在 compose 中只绑定 127.0.0.1。
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw --force enable

cat > /etc/fail2ban/jail.d/sshd.local <<'CONF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban
echo "服务器初始化完成。"
docker version --format '{{.Server.Version}}'
docker compose version
