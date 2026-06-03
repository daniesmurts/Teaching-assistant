#!/usr/bin/env bash
# vm-setup.sh — run ONCE as root on a fresh Yandex Cloud Ubuntu 24.04 VM.
# Provisions Node, PostgreSQL 15 + pgvector, Nginx, PM2, app user, and DB.
#
#   scp vm-setup.sh gradeassist@<VM_IP>:/tmp/   (or paste via console)
#   ssh root@<VM_IP> 'bash /tmp/vm-setup.sh'
set -euo pipefail

echo "▶ Swapfile (2 GB) FIRST — absorbs RAM spikes during the install itself"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab   # persists across reboots
  sysctl -w vm.swappiness=10
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

echo "▶ System update"
apt-get update && apt-get upgrade -y

echo "▶ Node.js 20 LTS"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "▶ PostgreSQL 15 + pgvector (via official PGDG repo)"
# Ubuntu 24.04's default repos ship PG16 and have no postgresql-15-pgvector,
# so add the PostgreSQL Global Development Group apt repo which has both.
apt-get install -y curl ca-certificates lsb-release
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update
# Install PG15 specifically (NOT the version-less metapackage, which pulls PG16).
# pgcrypto ships inside postgresql-15; pgvector is the separate package.
apt-get install -y postgresql-15 postgresql-client-15 postgresql-15-pgvector

echo "▶ PostgreSQL tuning for a 2 GB VM"
PG_CONF="/etc/postgresql/15/main/postgresql.conf"
if [ -f "$PG_CONF" ]; then
  sed -i "s/^#\?shared_buffers.*/shared_buffers = 256MB/"            "$PG_CONF"
  sed -i "s/^#\?effective_cache_size.*/effective_cache_size = 1GB/"  "$PG_CONF"
  sed -i "s/^#\?work_mem.*/work_mem = 8MB/"                          "$PG_CONF"
  sed -i "s/^#\?maintenance_work_mem.*/maintenance_work_mem = 128MB/" "$PG_CONF"
  systemctl restart postgresql
fi

echo "▶ Nginx"
apt-get install -y nginx

echo "▶ PM2 (global)"
npm install -g pm2

echo "▶ App user + directories"
id -u gradeassist &>/dev/null || useradd -m -s /bin/bash gradeassist
mkdir -p /var/www/gradeassist
mkdir -p /var/log/gradeassist
chown -R gradeassist:gradeassist /var/www/gradeassist /var/log/gradeassist

echo "▶ Database + pgvector extension"
# CHANGE THIS PASSWORD, then put the matching DATABASE_URL in /var/www/gradeassist/.env
DB_PASS="${DB_PASS:-change_me_strong_password}"
sudo -u postgres psql <<SQL
  SELECT 'CREATE DATABASE gradeassist'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'gradeassist')\gexec
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gradeassist_user') THEN
      CREATE USER gradeassist_user WITH ENCRYPTED PASSWORD '${DB_PASS}';
    END IF;
  END \$\$;
  GRANT ALL PRIVILEGES ON DATABASE gradeassist TO gradeassist_user;
SQL
sudo -u postgres psql -d gradeassist <<SQL
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  GRANT ALL ON SCHEMA public TO gradeassist_user;
SQL

echo "▶ Nginx site (edit server_name + SSL paths after first deploy)"
# Place the repo's deploy/nginx/gradeassist.conf here, then:
#   ln -sf /etc/nginx/sites-available/gradeassist /etc/nginx/sites-enabled/
#   nginx -t && systemctl reload nginx

cat <<DONE

✅ VM provisioned.

Next steps (do these once):
  1. Create /var/www/gradeassist/.env from .env.example with PRODUCTION values
       - DATABASE_URL=postgresql://gradeassist_user:${DB_PASS}@localhost:5432/gradeassist
       - NODE_ENV=production
       - FRONTEND_URL=https://gradeassist.ru
       - JWT_SECRET, DEEPSEEK_API_KEY, all YANDEX_* and SMTP_* keys
  2. Copy deploy/nginx/gradeassist.conf → /etc/nginx/sites-available/gradeassist
       edit server_name + ssl_certificate paths, then enable & reload nginx
  3. Run ./deploy.sh from your laptop to push code + build + migrate + start PM2
  4. pm2 startup   (run the printed command so the API survives reboots)
DONE
