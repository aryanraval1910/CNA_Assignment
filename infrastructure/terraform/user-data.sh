#!/bin/bash
set -Eeuo pipefail

exec > >(tee /var/log/logistics-bootstrap.log | logger -t logistics-bootstrap -s 2>/dev/console) 2>&1

export DEBIAN_FRONTEND=noninteractive
project_dir="/opt/${project_name}"

apt-get update
apt-get install -y ca-certificates curl git gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$${VERSION_CODENAME}") stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

if ! command -v amazon-ssm-agent >/dev/null 2>&1; then
  snap install amazon-ssm-agent --classic
fi
systemctl enable --now snap.amazon-ssm-agent.amazon-ssm-agent.service

if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

rm -rf "$project_dir"
git clone --depth 1 "${repository_url}" "$project_dir"

# The deployment workflow writes the protected .env file through SSM before
# the first Compose validation or startup.
chmod 755 "$project_dir"
