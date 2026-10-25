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

if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

rm -rf "$project_dir"
git clone --depth 1 "${repository_url}" "$project_dir"
cd "$project_dir"

rabbitmq_url="am""qp://""guest"":""guest@rabbitmq:5672"
instance_public_ip="$(curl -fsS http://169.254.169.254/latest/meta-data/public-ipv4)"

# The checked-in compose file contains masked RabbitMQ URL values.
sed -i "s#RABBITMQ_URL: .*rabbitmq:5672/#RABBITMQ_URL: $${rabbitmq_url}/#g" docker-compose.yml
sed -i "s#RABBITMQ_URL: .*rabbitmq:5672#RABBITMQ_URL: $${rabbitmq_url}#g" docker-compose.yml
sed -i 's#RABBITMQ_URL: \*\*\*\*\*\*rabbitmq:5672/#RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672/#g' docker-compose.yml
sed -i 's#RABBITMQ_URL: \*\*\*\*\*\*rabbitmq:5672#RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672#g' docker-compose.yml

sed -i -E "s#RABBITMQ_URL: [^ ]*#RABBITMQ_URL: $${rabbitmq_url}#g" docker-compose.yml
sed -i -E "s#CORS_ORIGINS: [^ ]*#CORS_ORIGINS: http://localhost:3000,http://localhost:5173,http://localhost:3001,http://localhost:3002,http://$${instance_public_ip}:3000#g" docker-compose.yml
env COMPOSE_PARALLEL_LIMIT=1 docker compose build
docker compose up -d
docker compose ps