# Deployment Guide — Secure Multi-Branch Document Exchange

## Prerequisites

- Node.js 18+ (20+ recommended)
- npm or bun
- Caddy (reverse proxy)
- PostgreSQL 14+ (required)
- Redis 6+ (optional, recommended for production)
- OpenSSL (for generating secrets)

## Quick Start (Development)

### 1. Install PostgreSQL

**Windows:**
```bash
# Download and install from https://www.postgresql.org/download/windows/
# Or use Chocolatey:
choco install postgresql

# Or use Docker:
docker run -d --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
```

**macOS:**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Linux:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### 2. Install Redis (Recommended)

Redis enables distributed rate limiting, session caching, and job deduplication.

**Windows:**
```bash
# Use Docker:
docker run -d --name redis -p 6379:6379 redis:7-alpine

# Or use Chocolatey:
choco install redis-64
```

**macOS:**
```bash
brew install redis
brew services start redis
```

**Linux:**
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis
```

### 2. Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE secure_exchange;

# Exit psql
\q
```

### 3. Setup Application

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your PostgreSQL credentials

# 3. Initialize database schema
npx prisma generate
npx prisma migrate dev --name init

# 4. Start the Exchange Hub
cd mini-services/exchange-hub
npm install
npm run dev

# 5. Start the Next.js server (in a new terminal)
npm run dev
```

### 4. Migrate Existing SQLite Data (Optional)

If you have an existing SQLite database, migrate it to PostgreSQL:

```bash
# Ensure DATABASE_URL points to PostgreSQL in .env
npx tsx prisma/migrate-sqlite-to-postgres.ts
```

## Production Deployment

### 1. Setup PostgreSQL

```bash
# Install PostgreSQL 16+ on your server
# Create production database and user
sudo -u postgres psql

CREATE USER secure_exchange WITH PASSWORD 'your-secure-password';
CREATE DATABASE secure_exchange OWNER secure_exchange;
GRANT ALL PRIVILEGES ON DATABASE secure_exchange TO secure_exchange;

# Enable required extensions
\c secure_exchange
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\q
```

### 2. Generate Security Secrets

```bash
# Generate session secret (64 chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate seed secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate hub server token
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Configure Environment

Create `.env` with production values:

```env
NODE_ENV=production
DATABASE_URL=postgresql://secure_exchange:your-secure-password@localhost:5432/secure_exchange?schema=public
DATABASE_POOL_SIZE=20
DATABASE_LOG_LEVEL=error
SESSION_SECRET=<generated-session-secret>
SEED_SECRET=<generated-seed-secret>
HUB_SERVER_TOKEN=<generated-hub-token>
LOG_LEVEL=info
```

### 4. Build and Start

```bash
# Build the application
npm run build

# Run database migrations
npx prisma migrate deploy

# Initialize/seed the database (first time only)
# This requires OWNER authentication and SEED_SECRET
curl -X POST http://localhost:3000/api/seed \
  -H "Content-Type: application/json" \
  -H "x-seed-secret: <your-seed-secret>" \
  -H "Cookie: secure-exchange-session=<owner-token>"

# Start the production server
npm run start
```

### 5. Configure Storage Backend

**Local Storage (Development):**
```env
STORAGE_BACKEND=local
STORAGE_LOCAL_PATH=db/vault
```

**S3-Compatible Storage (Production):**
```env
STORAGE_BACKEND=s3
S3_BUCKET=your-secure-exchange-vault
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
```

**MinIO (Self-hosted S3):**
```env
STORAGE_BACKEND=s3
S3_BUCKET=secure-exchange-vault
S3_ENDPOINT=https://minio.your-domain.com
S3_ACCESS_KEY_ID=your-minio-access-key
S3_SECRET_ACCESS_KEY=your-minio-secret-key
S3_FORCE_PATH_STYLE=true
```

**Cloudflare R2:**
```env
STORAGE_BACKEND=s3
S3_BUCKET=your-r2-bucket
S3_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=your-r2-access-key
S3_SECRET_ACCESS_KEY=your-r2-secret-key
```

### 6. PostgreSQL Backup Strategy

```bash
# Automated daily backup (add to crontab)
0 2 * * * pg_dump -U secure_exchange secure_exchange | gzip > /backups/secure_exchange_$(date +\%Y\%m\%d).sql.gz

# Retain backups for 7 days
0 3 * * * find /backups -name "secure_exchange_*.sql.gz" -mtime +7 -delete
```

### 7. S3 Backup Strategy

```bash
# Sync vault to backup bucket (add to crontab)
0 3 * * * aws s3 sync s3://your-vault-bucket s3://your-backup-bucket --sse AES256

# Enable versioning on the vault bucket for additional protection
aws s3api put-bucket-versioning --bucket your-vault-bucket --versioning-configuration Status=Enabled
```

### 4. Configure Caddy

Edit `Caddyfile` for production:

```
:443 {
  tls your-email@example.com

  @allowed_port query XTransformPort in 3000 3003

  handle @allowed_port {
    reverse_proxy localhost:{query.XTransformPort} {
      header_up Host {host}
      header_up X-Forwarded-For {remote_host}
      header_up X-Forwarded-Proto {scheme}
      header_up X-Real-IP {remote_host}
    }
  }

  handle {
    reverse_proxy localhost:3000 {
      header_up Host {host}
      header_up X-Forwarded-For {remote_host}
      header_up X-Forwarded-Proto {scheme}
      header_up X-Real-IP {remote_host}
    }
  }
}
```

### 5. Start Services

```bash
# Start Exchange Hub (as a service)
cd mini-services/exchange-hub
npm run start

# Start Caddy
caddy run --config Caddyfile

# Start Next.js (as a service)
npm run start
```

## Initial Setup

### First Login

1. Access the application at `https://your-domain.com`
2. Use the OWNER credentials from the seed output
3. **Change the OWNER password immediately**
4. Enable 2FA for the OWNER account
5. Create additional users with strong passwords

### Seed Credentials

After seeding, credentials are returned in the API response. Store them securely:
- OWNER: Full system control
- SECURITY_ADMIN: User/branch/key management
- BRANCH_ADMIN: Branch-level management
- USER: Document send/receive
- READONLY: View-only access

## Backup and Recovery

### Creating Backups

```bash
# Via API (OWNER only)
curl -X POST http://localhost:3000/api/backup \
  -H "Content-Type: application/json" \
  -H "Cookie: secure-exchange-session=<owner-token>" \
  -d '{"action": "create"}'
```

### Restoring from Backup

Backups are stored in `db/backups/`. To restore:

1. Stop all services
2. Copy the backup database over the current one
3. Copy vault files
4. Restart services

## Monitoring

### Health Check

```bash
curl http://localhost:3000/api/health
```

Returns:
- Database connectivity status
- System state (active/lockdown)
- Memory usage
- Uptime

### Logs

Logs are structured JSON. Use a log aggregator (ELK, Datadog, etc.) for production.

Environment variables:
- `LOG_LEVEL=info` (default)
- `LOG_LEVEL=debug` (verbose)

## Security Checklist

- [ ] All secrets generated and stored securely
- [ ] `.env` not committed to version control
- [ ] HTTPS enabled via Caddy
- [ ] Database credentials not in source code
- [ ] Owner password changed from seed default
- [ ] 2FA enabled for all admin accounts
- [ ] Regular backups configured
- [ ] Monitoring and alerting configured
- [ ] Audit logs reviewed regularly
- [ ] Key rotation schedule established

## Troubleshooting

### "Seeding is disabled in production"

Set `SEED_SECRET` environment variable and authenticate as OWNER.

### "Invalid seed secret"

Ensure the `x-seed-secret` header matches the `SEED_SECRET` env var.

### Hub connection failed

Check that:
1. Exchange Hub is running on port 3003
2. `HUB_SERVER_TOKEN` matches between Next.js and Hub
3. Caddy is forwarding correctly

### Database errors

Check:
1. `DATABASE_URL` is correct
2. Database server is running
3. User has appropriate permissions

## Scaling

### Horizontal Scaling

For multiple Next.js instances:
1. Use PostgreSQL instead of SQLite
2. Use Redis for session storage
3. Use Redis for rate limiting
4. Share the Exchange Hub connection

### Load Balancing

Configure Caddy or nginx to load balance across multiple Next.js instances.

## Support

For issues, check:
1. Application logs
2. Database connectivity
3. Hub connectivity
4. Caddy configuration
