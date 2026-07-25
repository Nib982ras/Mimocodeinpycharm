# Deployment Guide — Secure Multi-Branch Document Exchange

## Prerequisites

- Node.js 18+ (20+ recommended)
- npm or bun
- Caddy (reverse proxy)
- SQLite (development) or PostgreSQL (production)
- OpenSSL (for generating secrets)

## Quick Start (Development)

```bash
# 1. Install dependencies
npm install

# 2. Initialize database
npx prisma generate
npx prisma db push

# 3. Set up environment
cp .env.example .env
# Edit .env with your configuration

# 4. Start the Exchange Hub
cd mini-services/exchange-hub
npm install
npm run dev

# 5. Start the Next.js server (in a new terminal)
npm run dev
```

## Production Deployment

### 1. Generate Security Secrets

```bash
# Generate session secret (64 chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate seed secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate hub server token
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Configure Environment

Create `.env` with production values:

```env
NODE_ENV=production
DATABASE_URL=postgresql://user:password@localhost:5432/secure_exchange
SESSION_SECRET=<generated-session-secret>
SEED_SECRET=<generated-seed-secret>
HUB_SERVER_TOKEN=<generated-hub-token>
LOG_LEVEL=info
```

### 3. Build and Start

```bash
# Build the application
npm run build

# Initialize/seed the database (first time only)
# This requires OWNER authentication and SEED_SECRET
curl -X POST http://localhost:3000/api/seed \
  -H "Content-Type: application/json" \
  -H "x-seed-secret: <your-seed-secret>" \
  -H "Cookie: secure-exchange-session=<owner-token>"

# Start the production server
npm run start
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
