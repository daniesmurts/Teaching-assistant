// PM2 process config — lives on the VM at /var/www/gradeassist/backend
// Start:  pm2 start ecosystem.config.js --env production
module.exports = {
  apps: [{
    name:               'gradeassist-api',
    // rootDir is the repo root, so tsc preserves structure: backend/src → dist/backend/src
    script:             'dist/backend/src/index.js',
    cwd:                '/var/www/gradeassist/backend',
    // Cluster mode — two Node workers to use both vCPUs. PM2 load-balances
    // HTTP requests across workers. Bump proportionally when you grow the VM.
    instances:          2,
    exec_mode:          'cluster',
    autorestart:        true,
    watch:              false,        // never watch in production
    max_memory_restart: '512M',
    env_production: {
      NODE_ENV: 'production',
      PORT:     3000,
    },
    // PM2 does not read .env itself — Node loads it. The .env lives at the repo
    // root (/var/www/gradeassist/.env), matching the dev convention, so point
    // one level up from cwd.
    node_args:          '--env-file=../.env',
    log_date_format:    'YYYY-MM-DD HH:mm:ss',
    out_file:           '/var/log/gradeassist/out.log',
    error_file:         '/var/log/gradeassist/error.log',
    merge_logs:         true,
  }],
}
