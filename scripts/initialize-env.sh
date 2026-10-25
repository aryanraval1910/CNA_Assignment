#!/bin/sh
set -eu

env_file="${COMPOSE_ENV_FILE:-.env}"

has_required_credentials() {
  [ -s "$env_file" ] &&
    grep -q '^MYSQL_ROOT_PASSWORD=.[^[:space:]]*' "$env_file" &&
    grep -q '^MYSQL_PASSWORD=.[^[:space:]]*' "$env_file" &&
    grep -q '^POSTGRES_PASSWORD=.[^[:space:]]*' "$env_file" &&
    grep -q '^RABBITMQ_USER=.[^[:space:]]*' "$env_file" &&
    grep -q '^RABBITMQ_PASSWORD=.[^[:space:]]*' "$env_file"
}

if has_required_credentials; then
  chmod 600 "$env_file"
  exit 0
fi

temporary_file="${env_file}.tmp.$$"
trap 'rm -f "$temporary_file"' EXIT HUP INT TERM
umask 077

printf 'MYSQL_ROOT_PASSWORD=' > "$temporary_file"
openssl rand -hex 32 >> "$temporary_file"
printf 'MYSQL_USER=order_app\nMYSQL_PASSWORD=' >> "$temporary_file"
openssl rand -hex 32 >> "$temporary_file"
printf 'POSTGRES_USER=postgres\nPOSTGRES_PASSWORD=' >> "$temporary_file"
openssl rand -hex 32 >> "$temporary_file"
printf 'RABBITMQ_USER=logistics_app\nRABBITMQ_PASSWORD=' >> "$temporary_file"
openssl rand -hex 32 >> "$temporary_file"

chmod 600 "$temporary_file"
mv -f "$temporary_file" "$env_file"
trap - EXIT HUP INT TERM
