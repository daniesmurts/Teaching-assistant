# GradeAssist — Yandex Cloud Deployment Runbook

A one-VM setup: the VM runs the Node API + PostgreSQL; the React PWA is served
as static files from Object Storage (optionally fronted by Yandex CDN).

---

## Part A — Yandex Cloud setup (do this once, in the console)

### 1. Account, cloud, folder
1. Sign up at <https://console.yandex.cloud> and attach a billing account
   (card or invoice). New accounts get a grant.
2. A default **cloud** and **folder** are created. Note the **folder ID**
   (Folder dashboard → "ID" near the name). You'll need it for Vision OCR.

### 2. Service account + static keys (for Object Storage + Vision)
1. Folder → **Service accounts** → **Create**. Name: `gradeassist-sa`.
2. Roles: `storage.editor`, `ai.vision.user`.
3. Open the account → **Create new key**:
   - **Static access key** → gives `Access Key ID` + `Secret`.
     → these become `YANDEX_STORAGE_ACCESS_KEY` / `YANDEX_STORAGE_SECRET_KEY`.
   - **API key** → becomes `YANDEX_VISION_API_KEY`.

### 3. Object Storage bucket (frontend hosting)
1. **Object Storage** → **Create bucket**: name `gradeassist-frontend`,
   read access **public**.
2. Bucket → **Website** tab → enable static hosting, index = `index.html`,
   error = `index.html` (SPA fallback). Note the website endpoint, e.g.
   `gradeassist-frontend.website.yandexcloud.net`.
3. (Uploads bucket) Create a second **private** bucket `gradeassist-uploads`
   for student files → `YANDEX_STORAGE_BUCKET=gradeassist-uploads`.

### 4. Compute VM
1. **Compute Cloud** → **Create VM**.
   - Image: **Ubuntu 24.04**.
   - vCPU 2 / RAM 4 GB / SSD 20 GB (burstable is fine for MVP).
   - **Public IP**: ephemeral or static (static recommended so DNS is stable).
   - SSH: paste your public key, login `gradeassist` or `ubuntu`.
2. Note the **public IP**.

### 5. DNS
1. Point your domain at the VM:
   - `A` record `gradeassist.ru` → VM public IP.
   - `A` record `www.gradeassist.ru` → VM public IP.
2. You can use **Yandex Cloud DNS** or your registrar's panel.

### 6. SSL certificate
- Easiest: **Certificate Manager** → request a **Let's Encrypt** cert for
  `gradeassist.ru` + `www.gradeassist.ru` (HTTP or DNS challenge).
- Download / place the cert chain + key on the VM at
  `/etc/ssl/gradeassist/certificate.pem` and `/private.key`
  (or use certbot directly on the VM instead).

### 7. (Optional) CDN
- **Cloud CDN** → origin = the frontend bucket website endpoint,
  serve `gradeassist.ru`. If you do this, the Nginx frontend `location /`
  block is unnecessary — Nginx only needs to proxy `/api/`.

---

## Part B — Provision the VM (once, over SSH)

```bash
ssh gradeassist@YOUR.VM.IP

# Copy the setup script up (from your machine) OR paste it, then:
sudo DB_PASS='a_strong_db_password' bash vm-setup.sh
```
This installs Node 20, PostgreSQL 15 + pgvector, Nginx, PM2, creates the
`gradeassist` user, the database, and the extensions.

### Nginx
```bash
# Copy deploy/nginx/gradeassist.conf to the VM, then:
sudo cp gradeassist.conf /etc/nginx/sites-available/gradeassist
sudo ln -s /etc/nginx/sites-available/gradeassist /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Backend .env (on the VM, in /var/www/gradeassist/backend/.env)
```bash
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://gradeassist.ru
LOG_LEVEL=info
DATABASE_URL=postgresql://gradeassist_user:a_strong_db_password@localhost:5432/gradeassist
JWT_SECRET=<64+ random hex — node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
DEEPSEEK_API_KEY=<your key>
# Yandex (optional but recommended in prod)
YANDEX_FOLDER_ID=<folder id>
YANDEX_VISION_API_KEY=<api key>
YANDEX_STORAGE_BUCKET=gradeassist-uploads
YANDEX_STORAGE_ACCESS_KEY=<static access key id>
YANDEX_STORAGE_SECRET_KEY=<static secret>
YANDEX_STORAGE_ENDPOINT=https://storage.yandexcloud.net
# Email (optional)
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=465
SMTP_USER=noreply@gradeassist.ru
SMTP_PASS=<app password>
```

---

## Part C — Deploy (from your machine, repeatable)

Edit `VM_HOST` / `FRONTEND_BUCKET` at the top of `deploy/deploy.sh`, then:
```bash
./deploy/deploy.sh
```
It builds the frontend → uploads to the bucket, rsyncs the backend → VM,
runs `npm ci && build && migrate`, reloads PM2, and curls `/api/health`.

### First deploy only — seed yourself as platform admin
```bash
ssh gradeassist@YOUR.VM.IP
psql -d gradeassist -c "UPDATE teachers SET role='platform_admin' WHERE email='you@domain.ru';"
```

### Make PM2 survive reboots
```bash
pm2 startup    # run the printed command
pm2 save
```

---

## Pre-deploy checklist
- [ ] `.env` filled on the VM, never committed (verify `git ls-files .env` is empty)
- [ ] `npm run build` succeeds locally (frontend + backend)
- [ ] DNS resolves to the VM IP
- [ ] SSL cert present at the Nginx paths
- [ ] `GET https://gradeassist.ru/api/health` → 200 after deploy
- [ ] Login + one grading call work in production

---

## Part D — Database backups (set up once, before you need it)

A single-VM setup has no redundancy — a bad migration, a disk failure, or a
compromised VM can permanently destroy the database. Two independent
mechanisms, both needed:

1. **Nightly `pg_dump` → dedicated Object Storage bucket** (`npm run
   backup:db`, `backend/scripts/backupDatabase.ts`). Reports success/failure
   to Telegram every run.
   ```bash
   # VM one-time setup:
   #  1. Create a SEPARATE bucket + write-only service account (not the
   #     uploads bucket/account) — see .env.example for the BACKUP_STORAGE_*
   #     vars, and set a bucket lifecycle rule (~35 day expiry) in the console
   #     instead of giving the app delete permissions.
   #  2. crontab -e:
   0 3 * * * cd /var/www/gradeassist/backend && npm run backup:db >> /var/log/gradeassist/backup.log 2>&1
   #  3. Run it once manually and confirm the Telegram message arrives.
   ```

2. **Yandex Compute Cloud disk snapshot schedule** (console: Compute Cloud →
   VM → Disks → snapshot schedule, weekly, keep 2–3) — covers "the whole VM
   is gone," which the DB-only dump doesn't.

Full restore procedure: `docs/support/runbooks/restore-database.md`. Run it
as a quarterly drill, not just when something breaks.
