# Secure Multi-Branch Document Exchange System

A production-ready, cryptographically secure system for exchanging encrypted digital documents between multiple branches, departments, and authorized users.

## Features

### Security
- **End-to-end encryption** — ECC P-521 + AES-256-GCM + ECDSA-SHA512
- **Role-based access control** — OWNER > SECURITY_ADMIN > BRANCH_ADMIN > USER > READONLY
- **Two-factor authentication** — TOTP (RFC 6238) with backup codes
- **Session management** — HMAC-signed tokens with database-backed revocation
- **Audit logging** — Immutable audit trail for all sensitive operations
- **Rate limiting** — IP-based with progressive blocking
- **Security headers** — CSP, HSTS, X-Frame-Options, etc.

### Cryptography
- **Hybrid encryption** — ECDH key exchange + AES-256-GCM file encryption
- **Digital signatures** — ECDSA-SHA512 for authenticity and non-repudiation
- **Forward secrecy** — Ephemeral keys per document
- **Key management** — Encrypted at rest with master key
- **Key rotation** — Supported with versioning
- **Key destruction** — Cryptographic erasure of private keys

### Architecture
- **Next.js 16** — React 19 + TypeScript + Tailwind CSS
- **Prisma ORM** — Type-safe database access
- **Socket.IO** — Real-time presence and notifications
- **Caddy** — Reverse proxy with security headers
- **SQLite/PostgreSQL** — Flexible database backend

## Quick Start

```bash
# Install dependencies
npm install

# Initialize database
npx prisma generate
npx prisma db push

# Start the Exchange Hub
cd mini-services/exchange-hub
npm install
npm run dev

# Start the Next.js server
npm run dev
```

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/           # API routes
│   │   │   ├── auth/      # Authentication (login, logout, me)
│   │   │   ├── documents/ # Document upload/download/decrypt
│   │   │   ├── keys/      # Key management (rotate, revoke)
│   │   │   ├── users/     # User management
│   │   │   ├── branches/  # Branch management
│   │   │   ├── devices/   # Device registration
│   │   │   ├── licenses/  # License management
│   │   │   ├── 2fa/       # Two-factor authentication
│   │   │   ├── system/    # System control (activate, lockdown)
│   │   │   ├── backup/    # Backup management
│   │   │   ├── health/    # Health check
│   │   │   ├── metrics/   # Prometheus metrics
│   │   │   └── monitoring/# System monitoring
│   │   └── components/    # React components
│   ├── lib/
│   │   ├── auth.ts        # Authentication & authorization
│   │   ├── crypto.ts      # Cryptographic operations
│   │   ├── db.ts          # Database client
│   │   ├── storage.ts     # File storage
│   │   ├── audit.ts       # Audit logging
│   │   ├── cache.ts       # Caching layer
│   │   ├── validation.ts  # Input validation
│   │   ├── rate-limit.ts  # Rate limiting
│   │   ├── csrf.ts        # CSRF protection
│   │   ├── logger.ts      # Structured logging
│   │   ├── metrics.ts     # Prometheus metrics
│   │   ├── backup.ts      # Backup utilities
│   │   ├── error-boundary.ts # Error handling
│   │   ├── timeout.ts     # Request timeouts
│   │   └── test-utils.ts  # Test utilities
│   └── middleware.ts       # Security headers
├── prisma/
│   └── schema.prisma      # Database schema
├── mini-services/
│   └── exchange-hub/      # Socket.IO server
├── db/
│   ├── custom.db          # SQLite database
│   ├── vault/             # Encrypted documents
│   ├── backups/           # Database backups
│   └── temp/              # Temporary uploads
├── Caddyfile              # Reverse proxy config
└── .env.example           # Environment template
```

## API Endpoints

### Authentication
- `POST /api/auth/login` — Login with username/password + optional 2FA
- `POST /api/auth/logout` — Logout and revoke session
- `GET /api/auth/me` — Get current user

### Documents
- `GET /api/documents` — List documents
- `POST /api/documents` — Upload and encrypt document
- `GET /api/documents/:id` — Get document metadata
- `POST /api/documents/:id/decrypt` — Decrypt and download

### Keys
- `GET /api/keys` — List all keys (SECURITY_ADMIN+)
- `POST /api/keys/:id/rotate` — Rotate key
- `POST /api/keys/:id/revoke` — Destroy key (OWNER only)

### Users
- `GET /api/users` — List users (SECURITY_ADMIN+)
- `POST /api/users` — Create user (SECURITY_ADMIN+)
- `DELETE /api/users/:id` — Delete user (SECURITY_ADMIN+)
- `POST /api/users/:id/suspend` — Suspend user (SECURITY_ADMIN+)
- `POST /api/users/:id/password` — Reset password (SECURITY_ADMIN+)

### System
- `GET /api/system/state` — Get system status
- `POST /api/system/activate` — Activate system (OWNER)
- `POST /api/system/deactivate` — Deactivate system (OWNER)
- `POST /api/system/lockdown` — Emergency lockdown (OWNER)
- `POST /api/system/release` — Release lockdown (OWNER)

### Operations
- `GET /api/health` — Health check
- `GET /api/metrics` — Prometheus metrics
- `GET /api/monitoring` — System monitoring summary
- `POST /api/backup` — Create backup (OWNER)
- `GET /api/backup` — List backups (OWNER)

## Environment Variables

See `.env.example` for all configuration options.

Key variables:
- `DATABASE_URL` — Database connection string
- `SESSION_SECRET` — Session token signing key
- `SEED_SECRET` — Seed endpoint protection
- `HUB_SERVER_TOKEN` — Exchange Hub authentication

## Security Model

### Authentication Flow
1. User submits credentials
2. Server verifies password (constant-time comparison)
3. Server checks 2FA if enabled
4. Server creates session token (HMAC-signed)
5. Server stores JTI in database
6. Server sets httpOnly cookie
7. Subsequent requests verify token + JTI

### Authorization Matrix
| Action | OWNER | SEC_ADMIN | BRANCH_ADMIN | USER | READONLY |
|--------|-------|-----------|--------------|------|----------|
| Send document | ✓ | ✓ | ✓ | ✓ | ✗ |
| Decrypt document | ✓ | ✓ | ✓ (own branch) | ✓ (own branch) | ✗ |
| Create user | ✗ | ✓ | ✗ | ✗ | ✗ |
| Rotate keys | ✗ | ✓ | ✗ | ✗ | ✗ |
| Destroy keys | ✓ | ✗ | ✗ | ✗ | ✗ |
| System lockdown | ✓ | ✗ | ✗ | ✗ | ✗ |

### Cryptographic Operations

**Document Encryption:**
1. Generate random session key
2. AES-256-GCM encrypt document
3. ECDH with ephemeral key pair
4. HKDF derive key-encryption key
5. AES-256-GCM encrypt session key
6. ECDSA-SHA512 sign ciphertext

**Document Decryption:**
1. ECDH with recipient's private key + ephemeral public key
2. HKDF derive key-encryption key
3. AES-256-GCM decrypt session key
4. AES-256-GCM decrypt document
5. Verify ECDSA signature
6. Verify document hash

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions.

## Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage

# Run integration tests
npm run test:integration
```

## Monitoring

- Health check: `GET /api/health`
- Metrics: `GET /api/metrics` (Prometheus format)
- Monitoring: `GET /api/monitoring` (SECURITY_ADMIN+)

## License

Proprietary — Internal use only.
