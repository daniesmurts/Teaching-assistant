#!/bin/bash
# vm-setup.sh — run ONCE as root on a fresh Yandex Cloud Ubuntu 24.04 VM.
# Min spec: 2 vCPU, 4 GB RAM, 20 GB SSD.
set -e

echo "▶ System update"
apt-get update && apt-get upgrade -y

echo "▶ Node.js 20 LTS"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "▶ PostgreSQL 15 + pgvector"
apt-get install -y postgresql postgresql-contrib postgresql-15-pgvector

echo "▶ Nginx"
apt-get install -y nginx

echo "▶ PM2 (global)"
npm install -g pm2

echo "▶ Application user + directories"
id gradeassist &>/dev/null || useradd -m -s /bin/bash gradeassist
mkdir -p /var/www/gradeassist /var/log/gradeassist /var/www/gradeassist/uploads
chown -R gradeassist:gradeassist /var/www/gradeassist /var/log/gradeassist

echo "▶ PostgreSQL database + user + extensions"
# Edit the password before running, or set DB_PASS env var.
DB_PASS="${DB_PASS:-change_me_strong_password}"
sudo -u postgres psql <<SQL
  SELECT 'CREATE DATABASE gradeassist' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='gradeassist')\gexec
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='gradeassist_user') THEN
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

echo "✓ VM setup complete."
echo "  Next: copy backend code to /var/www/gradeassist/backend, add .env, run migrations, pm2 start."
