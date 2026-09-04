#!/usr/bin/env bash
###############################################################################
# setup-host.sh — ONE-TIME host prep for running Fabric under Docker Engine in
# WSL2 Ubuntu. Run once with sudo:   sudo ./setup-host.sh
#
# Fixes three environment traps discovered standing this up:
#   1. Fabric's network.sh calls `docker-compose` (v1). Only the `docker compose`
#      v2 plugin is installed, and a leftover Docker Desktop shim on the Windows
#      PATH hijacks the call. We install a real shim that forwards to the plugin.
#   2. Chaincode build/CCaaS containers can't resolve DNS by default in WSL2
#      (npm EAI_AGAIN). We pin Docker daemon DNS to 8.8.8.8 / 1.1.1.1.
#   3. network.sh / deployCC(AAS) need `jq`.
###############################################################################
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo: sudo $0"; exit 1; }

echo "### docker-compose shim -> 'docker compose'"
printf '#!/bin/sh\nexec docker compose "$@"\n' > /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

echo "### docker daemon DNS"
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "dns": ["8.8.8.8", "1.1.1.1"]
}
EOF
systemctl restart docker
sleep 3
systemctl is-active docker

echo "### jq"
command -v jq >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq jq; }
echo "jq: $(jq --version)"

echo "### container DNS check"
docker run --rm busybox nslookup registry.npmjs.org 2>&1 | head -3 || true
echo "SETUP DONE"
