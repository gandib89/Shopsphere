#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 24.04 EC2 instance. Run as the default ubuntu user:
#   curl -fsSL https://raw.githubusercontent.com/gandib89/Shopsphere/main/deploy/aws/bootstrap.sh | bash
set -euo pipefail

# 2 GB of RAM is tight for Keycloak plus image builds; swap keeps the OOM killer away.
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

[ -d ~/Shopsphere ] || git clone https://github.com/gandib89/Shopsphere.git ~/Shopsphere

echo "Done. Log out and back in (docker group), then follow deploy/aws/README.md from step 4."
