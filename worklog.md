# Secure Multi-Branch Document Exchange System — Worklog

---
Task ID: 1
Agent: main
Task: Build the cryptographic foundation (Prisma schema, crypto library, storage, audit, seed) for the Secure Multi-Branch Document Exchange System.

Work Log:
- Defined Prisma schema: Branch (hierarchical), Key (ECDH+ECDSA P-521), Document (secure package), AuditLog.
- Implemented `src/lib/crypto.ts` with the full hybrid workflow: ECC P-521 key generation, ECDH via JWK round-trip, HKDF-SHA256, AES-256-GCM, ECDSA-SHA512 signing/verification, private-key encryption at rest with a master key (HSM stand-in).
- Implemented `src/lib/storage.ts` for on-disk ciphertext vault and `src/lib/audit.ts` for immutable audit logging.
- Implemented `src/lib/seed.ts` to provision HQ + 3 regions + 7 departments + 4 sub-branches (14 branches, 28 key pairs).
- Fixed a bug where the session-key auth tag was discarded; added `sessionAuthTag` field throughout.
- Added Key↔Document relations (`senderKey`/`recipientKey`) to the schema.

Stage Summary:
- Crypto round-trip verified: encrypt → decrypt returns original plaintext, ECDSA signature valid, SHA-512 hash valid, tamper detection works.
- Database seeded (14 branches, 28 keys). All API routes (dashboard, branches, keys, documents, audit) return 200.
- End-to-end document exchange verified via curl: upload+encrypt (DEPT-A1 → DEPT-B1), then decrypt returns original content with `X-Signature-Valid: true`, `X-Document-Hash-Valid: true`.
- Dev server runs on port 3000. Note: background server process can be killed between separate Bash tool calls; restart with `setsid bash -c 'bun run dev > dev.log 2>&1' & disown` when needed.

---
Task ID: 2-8
Agent: main
Task: Build the full frontend (shared helpers, page shell, 5 sections) and verify end-to-end with Agent Browser.

Work Log:
- Created shared frontend layer: `src/lib/types.ts` (API types), `src/lib/api.ts` (fetch wrappers), `src/lib/format.ts` (formatters, branch/audit metadata).
- Built `src/app/page.tsx`: dark slate + emerald security console with sidebar nav (Dashboard, Documents, Branches, Key Vault, Audit Log), crypto-status card, sticky footer with compliance badges, mobile Sheet drawer.
- Built `src/components/sections/shared.tsx` (Panel, PanelHeader, StatCard, Badge, EmptyState) for consistent dark theme.
- Dashboard: 4 stat cards, hierarchical topology tree, crypto stack diagram, recent documents, live activity feed, security properties grid.
- Documents: encrypt+dispatch form (sender/recipient selects, file picker), 7-step workflow visualization, secure-packages list, package-detail dialog (nonce, hash, keys, route), decrypt button that downloads the file and shows a signature/integrity verification card.
- Branches: hierarchical tree view with type legend + counts, add-branch dialog that provisions new ECC key pairs.
- Keys: full table of ECC P-521 keys (branch, purpose, algorithm, fingerprint, version, status), key-detail dialog with full public-key PEM, rotate-key confirmation (marks old ROTATED, generates v+1).
- Audit: filter chips per action, full immutable event table with parsed JSON details.
- Fixed bugs found during verification: `UPLOAD is not defined` (object shorthand in audit.tsx), missing `branch` relation on AuditLog (500 on /api/audit), session-key auth-tag bug in crypto.

Stage Summary:
- ESLint passes clean (no errors/warnings).
- Agent Browser end-to-end verification (all in one command to keep dev server alive):
  * Dashboard renders with stats, topology tree, crypto stack, activity feed.
  * Documents golden path: selected sender DEPT-A1 + recipient DEPT-B1, uploaded strategy.txt, clicked Encrypt & Send → toast "encrypted/delivered" + document listed.
  * Decrypted the document → browser downloaded the file and the verification card showed "Signature valid" + "Integrity verified" + SHA-512 hash.
  * Branches tree, Keys table, and Audit log all render with real data.
  * No console/runtime errors on any section.
- VLM screenshot review confirmed: professional dark navy + teal theme, clean layout, no overlaps or cut-off text, all sections display data properly.
- Database: 14 branches, 28 keys, audit trail populated with UPLOAD/DOWNLOAD/SEED events.
- Dev server runs on port 3000.

---
Task ID: 9-14
Agent: main
Task: Add real-time multi-client support — each branch as an independent connected client with live presence, instant document delivery, and dynamic branch joining.

Work Log:
- Created `mini-services/exchange-hub/` (port 3003): a socket.io hub that tracks online branch clients (presence) and broadcasts `document:delivered`, `document:sent`, `document:decrypted`, `branch:created`, `branch:online`, `branch:offline`, and `clients:list` events. The Next.js API server connects to it as a privileged "server" client via socket.io-client to forward server-side events (`server:notify`).
- Created `src/lib/hub-client.ts`: a singleton server-side socket.io-client that the API routes use to notify the hub (best-effort, non-blocking).
- Wired `hubNotify` into the document-upload, document-decrypt, and branch-create API routes.
- Created `src/components/client-mode.tsx`: ClientModeProvider context that lets the user pick which branch they're operating as (persisted in localStorage). When an identity is chosen, it opens a socket.io connection to the hub via `io("/?XTransformPort=3003")`, emits `client:join`, and listens for all live events — pushing them as notifications.
- Created `src/components/client-ui.tsx`: IdentitySelector (header dropdown), NotificationsBell (popover of live events), ConnectedClientsPanel (sidebar presence list).
- Updated `src/app/page.tsx`: wrapped in ClientModeProvider, added identity selector + bell + FIPS badge to header, replaced the static "All systems secure" widget with the live ConnectedClientsPanel, footer shows the active client identity.
- Updated `src/components/sections/documents.tsx`: when a client identity is active, the sender is locked to that identity, an Inbox/Outbox/All tab filter appears, and the list shows "to you"/"from you" badges. A 5s poll refreshes the inbox for live delivery.
- Fixed bugs: empty-string SelectItem value (Radix rejects it → used `__none__` sentinel), React 19 `set-state-in-effect` lint (used lazy useState initializer + useRef for the socket), native input value setter for React 19 controlled inputs in the add-branch dialog.

Stage Summary:
- Exchange hub runs on port 3003; Next.js on port 3000. Both started. The frontend connects through Caddy (port 81) using `?XTransformPort=3003`.
- Agent Browser end-to-end verification (through Caddy on port 81):
  * Observer mode → page loads, sidebar shows "Select a branch identity to connect" hint.
  * Picked DEPT-A1 → hub logged `branch online: DEPT-A1`, header shows "Live" badge, Connected Clients panel shows "DEPT-A1 (you)".
  * Sent strategy.txt DEPT-A1 → DEPT-B1 → hub broadcast `document:delivered`, toast "encrypted & delivered" appeared.
  * Switched identity to DEPT-B1 → hub logged `branch online: DEPT-B1`; Documents inbox shows strategy.txt with a "to you" badge; bell badge shows 9 live notifications.
  * Added a new department DEPT-D1 via the Branches dialog → 15 branches total, DEPT-D1 appears in the topology tree with freshly provisioned ECC key pairs.
- VLM screenshot review confirmed: client identity visible in header, "Live" connection indicator, Connected Clients panel (1 online), no errors.
- ESLint passes clean. The server keeps running while clients join/leave and new branches are added — exactly the "independent clients, everyone connected, add departments through it" behavior requested.

---
Task ID: 15-22
Agent: main
Task: Make the server operational with real authentication — each department/section PC/tablet logs in with username+password to send/receive encrypted files; admins can view/add/delete users.

Work Log:
- Added `User` model (username, displayName, passwordHash, role ADMIN|USER, branchId). Updated seed to provision 1 admin (`admin`/`admin123`) + one user per department (`dept-a1`/`dept-a1`, etc.).
- Created `src/lib/auth.ts`: scrypt password hashing, HMAC-signed session tokens (JWT-like), httpOnly cookie, `getSession()`/`requireUser()`/`requireAdmin()` server helpers, `AuthError` + `authErrorResponse`.
- Auth API routes: `/api/auth/login` (verify + set cookie + audit), `/api/auth/logout` (clear cookie), `/api/auth/me` (current session).
- User management API (admin-gated): `GET/POST /api/users`, `DELETE /api/users/[id]`, `POST /api/users/[id]/password` (reset). All return 401 unauth / 403 non-admin.
- Protected ALL existing APIs:
  * `POST /api/documents` → requireUser; sender forced to session.branchId for USER (admin picks any). Audit actor = username.
  * `POST /api/documents/[id]/decrypt` → requireUser; only recipient branch (or admin) may decrypt; 403 otherwise with FAILURE audit.
  * `GET /api/documents` + `/api/documents/[id]` → users see only their branch's docs; admin sees all.
  * `POST /api/branches` → requireAdmin. `GET /api/branches` → any authed user.
  * `GET /api/keys` + `POST /api/keys/[id]/rotate` → requireAdmin.
  * `GET /api/dashboard` + `/api/audit` → scoped to the user's branch for USER; full for ADMIN.
- Created `src/components/auth-provider.tsx` (replaces client-mode): loads session via `/api/auth/me`, exposes `login`/`logout`/`refresh`, auto-joins the exchange hub as the user's branch (USER only; admin observes).
- Created `src/components/login-screen.tsx`: full-page branded login with username/password, show-password toggle, demo-account hints, error states.
- Refactored `src/components/client-ui.tsx`: replaced IdentitySelector with `UserMenu` (shows displayName + role + branch code + Sign out button); NotificationsBell now keyed off the auth user.
- Created `src/components/sections/users.tsx` (admin): searchable user table with avatars, role badges, branch chips; Add User dialog (username, display name, password, role, branch); Delete User confirmation (cannot delete self); Reset Password dialog.
- Refactored `src/app/page.tsx`: AuthProvider wrapper → loading splash → login screen (if no session) → app shell. Role-based nav (Branches/Keys/Users admin-only, auto-hidden for regular users). Header shows Admin badge + UserMenu + NotificationsBell. Footer shows `@username · branch`.

Stage Summary:
- ESLint clean. Exchange hub on :3003, Next.js on :3000 — both running.
- Agent Browser end-to-end verification (all green):
  * Login screen renders (SecureExchange branding, demo-account hints).
  * dept-a1 logs in → dashboard, `@dept-a1` in header, admin-only nav (Users/Branches/Keys) HIDDEN.
  * Sender locked to dept-a1's account; sent report.txt → DEPT-B1; toast + document listed.
  * Logout → back to login screen.
  * admin logs in → Admin badge visible, all admin nav (Users, Branches, Keys) appears.
  * Users section lists all 7 accounts (admin + 6 dept users).
  * Created new user `dept-d2` (USER, branch DEPT-C2) → appears in table.
  * Deleted `dept-d2` → removed from table. Cannot delete own account (button disabled).
- API access control verified via curl: unauth→401, regular user→403 on /api/users, admin→200; wrong password→401; dashboard scoped to branch for regular users.
- VLM screenshot review confirmed: login screen, dept-a1 dashboard, admin user-management all render correctly with the right role/identity shown.
- Default credentials: admin/admin123 (full management) and dept-a1..dept-c2 / same-as-username (branch users).

---
Task ID: 23
Agent: main
Task: Fix the "Authentication required" runtime crash — when a session expires or is invalidated, the app was throwing uncaught 401 errors from api.ts, crashing the React tree.

Work Log:
- Root cause: the `json()` helper in `src/lib/api.ts` threw an Error on any non-OK response. Several section loaders (documents, branches, keys, audit, users) had `try/finally` without a `catch`, so the throw became an unhandled promise rejection → React error overlay. The Documents section's 5s poll made this especially likely to trigger mid-session.
- Fix layer 1 — `src/lib/api.ts`: on HTTP 401, dispatch a global `window` event `auth:unauthorized` before throwing. Introduced `ApiError` class carrying the status code. Added the same 401-event dispatch to the `decryptDocument` helper. Exported `isUnauthorized()` helper.
- Fix layer 2 — `src/components/auth-provider.tsx`: added a `useEffect` that listens for `auth:unauthorized` and calls `setUser(null)` + `refresh()` (which re-checks `/api/auth/me`). If the session is truly gone, the app flips to the login screen; if it was transient, the user stays logged in.
- Fix layer 3 — all section loaders: added `catch` blocks to `load()` in documents, branches, keys, audit, and users sections. Errors are swallowed (previous state is kept); the 401 event handles the redirect. The users section also got explicit 401 detection on its raw `fetch` calls.
- ESLint passes clean.

Stage Summary:
- Agent Browser verification (as dept-a1 USER with active 5s poll):
  * Logged in as dept-a1 → Documents page (poll active).
  * Invalidated session via /api/auth/logout (clears httpOnly cookie).
  * Waited 8s → the poll fired, hit 401, dispatched auth:unauthorized.
  * App gracefully returned to the login screen (login:true, docs:false). NO browser errors, NO crash overlay.
- VLM confirmed the screenshot shows the login screen, not an error.
- The crash is fully fixed: expired/invalid sessions now gracefully redirect to login instead of throwing an uncaught error.

---
Task ID: 2FA-DEVICE-LICENSE-APIs
Agent: general-purpose
Task: Build 2FA enrollment/verification, device registration/revocation, and license issuance/revocation/validation API routes.

Work Log:
- Extended `src/lib/audit.ts`: relaxed `AuditAction` to a free-form string so new event types can be added without a type migration; added `actorId` field on `AuditEntry` (already in the Prisma schema, was just not threaded through the helper); added a `clientIp(req)` helper that reads `x-forwarded-for` / `x-real-ip`.
- Rewrote `src/app/api/auth/login/route.ts` as a two-step login:
  * Always runs `verifyPassword` (against a fixed dummy hash when the user doesn't exist) to avoid timing-based user enumeration.
  * Suspended/revoked accounts → 403 `Account is {status}` (only revealed after the password is verified, so a wrong-password attacker can't enumerate statuses).
  * System-state guards: deactivated / lockdown blocks all non-OWNER logins with a 403 + audited reason.
  * If the user has `TwoFactor.enabled` and no factor was supplied → returns `{ok:false, requiresTwoFactor:true}` WITHOUT setting the cookie (the frontend prompts and resubmits the full triple).
  * `totpCode` verified via `verifyTotp(decryptPrivateKey(secret,iv), code)`.
  * `backupCode` matched against the JSON-array `backupCodesHash`; on match the consumed hash is spliced out (single-use). Failures audit `2FA_FAIL` without revealing which factor was wrong.
  * On success: creates a `Session` row keyed by the JWT's `jti`, sets the httpOnly cookie, audits `LOGIN` status=SUCCESS, returns `{ok:true, user:{..., twoFactorEnabled, twoFactorEnforced}}`.
- Created `src/app/api/2fa/setup/route.ts`: generates a fresh TOTP secret, encrypts it with `encryptPrivateKey` (AES-256-GCM master key), generates 10 one-time backup codes (scrypt-hashed, JSON array). Upserts the `TwoFactor` row with `enabled=false` and `enforced` true for OWNER/SECURITY_ADMIN/BRANCH_ADMIN. Returns the plaintext secret + otpauth URI + plaintext backup codes ONCE. Audits `2FA_ENROLL`.
- Created `src/app/api/2fa/verify/route.ts`: loads the user's pending (enabled=false) TwoFactor row, decrypts the secret, verifies the submitted 6-digit code via `verifyTotp`. On success flips `enabled=true` + `enrolledAt=now`. Audits `2FA_VERIFY` (success) or `2FA_FAIL` (failure).
- Created `src/app/api/2fa/disable/route.ts`: a user can disable their own 2FA; cross-user disable requires SECURITY_ADMIN+ (and they can't touch a peer/higher-privileged user). Deletes the `TwoFactor` row and burns all active sessions for the target so they re-authenticate with the new (lower) factor requirements. Audits `2FA_DISABLE` with `{target, self}`.
- Created `src/app/api/devices/route.ts`:
  * GET — users see their own devices; SECURITY_ADMIN+ sees all with owning user + license info.
  * POST `{name, publicKeyPem}` — derives the device fingerprint as `sha256Hex(publicKeyPem)` (unique), creates the Device row with `status=ACTIVE`, audits `DEVICE_REGISTER`. 409 on duplicate fingerprint.
- Created `src/app/api/devices/[id]/revoke/route.ts` (SECURITY_ADMIN+): marks the device `REVOKED` with `revokedAt/revokedBy`, also revokes the device's license (if any) with reason "Device revoked". Audits `DEVICE_REVOKE` with `{deviceId, fingerprint, owner, licenseRevoked}`.
- Created `src/app/api/licenses/route.ts` (SECURITY_ADMIN+):
  * GET — lists every license with its device + owner resolved.
  * POST `{deviceId, tier?, expiresInDays}` — builds the canonical `LicensePayload` `{deviceId, deviceFingerprint, tier, issuedAt, expiresAt}`, signs it with `signLicense` (ECDSA-P521-SHA512), generates a human-readable `licenseKey` (`SE-XXXX-XXXX-XXXX-XXXX`), records `signerFingerprint` (SHA-256 of the licensing public key), persists the License row. 409 if the device already has a license; 400 if the device is revoked. Audits `LICENSE_ISSUE`.
- Created `src/app/api/licenses/[id]/revoke/route.ts` (SECURITY_ADMIN+): marks the license `REVOKED` with `revokedAt/revokedBy/revokeReason` (default "Revoked by administrator"). Audits `LICENSE_REVOKE`. 409 if already revoked.
- Created `src/app/api/licenses/validate/route.ts` (any authenticated user): looks up the license by `licenseKey`, loads its device, updates `device.lastSeenAt/lastSeenIp` (even on failures — for observability), reconstructs the payload from stored fields, rejects with `FINGERPRINT_MISMATCH` if `device.fingerprint !== body.deviceFingerprint`, then calls `isLicenseValid(payload, signature, status)` which checks revoked/suspended/expired/invalid-signature. Audits `LICENSE_VALIDATE` with status SUCCESS/FAILURE + reason. Returns `{ok:valid, valid, reason?, license:{...sanitized}}`.
- All nine routes use the same error-handling pattern (`authErrorResponse(err) ?? NextResponse.json({ok:false, error:"..."}, {status:500})`), `export const dynamic = "force-dynamic"`, and the Next.js 16 `params: Promise<{id:string}>` signature for `[id]` routes.
- Ran `bun run db:generate` + `bun run db:push` to regenerate the Prisma client so the new `TwoFactor`/`Session`/`Device`/`License` relations are visible at runtime (the previous client was missing `twoFactor` on `User`, which was surfacing as 500s on login).

Stage Summary:
- ESLint passes clean (exit 0).
- End-to-end curl verification (server restarted with `setsid bash -c 'bun next dev -p 3000 > dev.log 2>&1' & disown` in a single Bash call to keep it alive across tool invocations):
  * **2FA happy path**: secadmin logins → setup → returns secret + 10 backup codes → verify with TOTP → enabled=true → logout → login without factor returns `{ok:false, requiresTwoFactor:true}` (no cookie set) → login with TOTP succeeds → login with WRONG TOTP returns 401 "Invalid 2FA code".
  * **Backup codes**: USER dept-a1 enrolled, used 1st backup code → login succeeded → re-using the same backup code returns 401 (single-use enforcement verified — the hash was spliced out of the JSON array).
  * **2FA disable**: secadmin cross-user disables dept-a1's 2FA → 200; dept-a1's sessions are revoked (subsequent calls with the old cookie return 401). USER attempting cross-user disable returns 403.
  * **Devices**: secadmin registers a device with a freshly generated P-521 public key → 200, fingerprint = SHA-256(PEM). GET /api/devices shows the new device with owner + license. dept-a1 (USER) GET /api/devices returns 200 with an empty list (own only) and `admin:false`.
  * **Licenses**: secadmin issues an ENTERPRISE license for 7 days → 200 with ECDSA signature + licenseKey. GET /api/licenses lists it. Validate with correct fingerprint → 200 valid:true. Validate with wrong fingerprint → 200 valid:false reason:"Device fingerprint does not match license". Validate non-existent key → 404. Revoke license → 200; subsequent validation returns valid:false reason:"License revoked". Device revoke also cascades to its license (verified in DB).
  * **Access control**: USER gets 403 on `GET /api/licenses`, `POST /api/devices/[id]/revoke`; unauthenticated gets 401 on `/api/2fa/setup`. Owner bypasses system-deactivated/lockdown (not exercised here but the code path is in place).
- Files created/modified:
  * `src/lib/audit.ts` (modified — added actorId + clientIp)
  * `src/app/api/auth/login/route.ts` (rewritten — two-step 2FA login)
  * `src/app/api/2fa/setup/route.ts` (new)
  * `src/app/api/2fa/verify/route.ts` (new)
  * `src/app/api/2fa/disable/route.ts` (new)
  * `src/app/api/devices/route.ts` (new)
  * `src/app/api/devices/[id]/revoke/route.ts` (new)
  * `src/app/api/licenses/route.ts` (new)
  * `src/app/api/licenses/[id]/revoke/route.ts` (new)
  * `src/app/api/licenses/validate/route.ts` (new)
- Known issue (pre-existing, out of scope): the older API routes (`/api/branches`, `/api/keys`, `/api/users`, `/api/dashboard`, `/api/audit`, `/api/documents`) still call `requireAdmin` (removed in the role refactor) and compare `role === "ADMIN"`. ESLint's `no-undef` is off so lint passes, but `next build` / `tsc --noEmit` would fail. A future task should migrate those routes to the new `requireSecurityAdmin` / role names. None of the new 2FA/device/license routes are affected.
- Default credentials for the seeded accounts (unchanged): `owner/owner123`, `secadmin/secadmin123`, `dept-a1..dept-c2/<username>`.

---
Task ID: ROLE-MIGRATION
Agent: general-purpose
Task: Migrate all existing API routes from the removed requireAdmin() to the new role system (OWNER/SECURITY_ADMIN/BRANCH_ADMIN/USER/READONLY) with least-privilege enforcement.

Work Log:
- Audited `src/lib/auth.ts`: confirmed the removed `requireAdmin()` is replaced by `requireUser()` / `requireRole(minRole)` / `requireSecurityAdmin()` / `requireOwner()` / `requireSystemActive()`, with `ROLE_RANK` exported for explicit rank comparisons. `SessionUser` now carries `status`, `twoFactorEnabled`, `twoFactorEnforced`.
- Migrated 11 route files + `auth/me`:
  * `api/dashboard/route.ts` — `requireUser()`; replaced `session.role === "ADMIN"` with `const isAdmin = ROLE_RANK[session.role] >= ROLE_RANK.SECURITY_ADMIN;` so SECURITY_ADMIN+/OWNER see the whole network, everyone else is scoped to their branch.
  * `api/audit/route.ts` — `requireUser()`; same `ROLE_RANK`-based scoping for both the `findMany` and the action-count `groupBy` (replaced `session.role !== "ADMIN"`).
  * `api/branches/route.ts` — GET stays `requireUser()`; POST switched from `requireAdmin()` to `requireSecurityAdmin()`.
  * `api/keys/route.ts` — `requireAdmin()` → `requireSecurityAdmin()`.
  * `api/keys/[id]/rotate/route.ts` — `requireAdmin()` → `requireSecurityAdmin()` (audit actor kept).
  * `api/users/route.ts` — GET+POST → `requireSecurityAdmin()`. Listing now includes `twoFactor: {select:{enabled,enforced}}` and exposes `status`/`twoFactorEnabled`/`twoFactorEnforced`. POST validates against the new role enum (`OWNER|SECURITY_ADMIN|BRANCH_ADMIN|USER|READONLY`), rejects `role==="OWNER"` with 400 "Owner role cannot be created", and requires a branchId for `BRANCH_ADMIN`/`USER`/`READONLY` (OWNER/SECURITY_ADMIN may be branchless). New users are created with `status: "ACTIVE"`.
  * `api/users/[id]/route.ts` — `requireAdmin()` → `requireSecurityAdmin()`. Added: 400 if target `role === "OWNER"` ("Owner accounts cannot be deleted"). Added `db.session.deleteMany({ where: { userId: id } })` before the user delete so the deleted user's cookies are immediately invalidated.
  * `api/users/[id]/password/route.ts` — `requireAdmin()` → `requireSecurityAdmin()`.
  * `api/documents/route.ts` — GET stays `requireUser()` with `ROLE_RANK`-based scoping (replaced `session.role === "ADMIN"`). POST switched from `requireUser()` to `requireSystemActive()` (blocks transfers during lockdown/deactivation; owner bypasses). Added early 403 "Read-only users cannot send documents" when `session.role === "READONLY"`. Sender-locking now uses `const canPickSender = ROLE_RANK[session.role] >= ROLE_RANK.SECURITY_ADMIN;` so SECURITY_ADMIN+/OWNER may pick any sender, USER/BRANCH_ADMIN are forced to their branch.
  * `api/documents/[id]/route.ts` — `requireUser()`; authorization check replaced `session.role !== "ADMIN"` with `const isAdmin = ROLE_RANK[session.role] >= ROLE_RANK.SECURITY_ADMIN;` then `!isAdmin && ...`.
  * `api/documents/[id]/decrypt/route.ts` — `requireUser()` → `requireSystemActive()`; added 403 "Read-only users cannot decrypt documents" for READONLY; authorization check replaced `session.role !== "ADMIN"` with `const isAdmin = ROLE_RANK[session.role] >= ROLE_RANK.SECURITY_ADMIN;`. Crypto/audit/hub-notify flow unchanged.
  * `api/auth/me/route.ts` — now returns `status`, `twoFactorEnabled`, `twoFactorEnforced` alongside the existing fields (all already on `SessionUser`).
- Verified: no remaining `requireAdmin` imports or `role === "ADMIN"` / `role !== "ADMIN"` checks anywhere under `src/app/api/`.
- Ran `bun run lint` → exit 0, clean (no errors/warnings).

Stage Summary:
- ESLint passes clean (exit 0). All 11 routes plus `auth/me` migrated to least-privilege role helpers.
- Files changed:
  * `src/app/api/dashboard/route.ts`
  * `src/app/api/audit/route.ts`
  * `src/app/api/branches/route.ts`
  * `src/app/api/keys/route.ts`
  * `src/app/api/keys/[id]/rotate/route.ts`
  * `src/app/api/users/route.ts`
  * `src/app/api/users/[id]/route.ts`
  * `src/app/api/users/[id]/password/route.ts`
  * `src/app/api/documents/route.ts`
  * `src/app/api/documents/[id]/route.ts`
  * `src/app/api/documents/[id]/decrypt/route.ts`
  * `src/app/api/auth/me/route.ts`
- Access-control matrix (least-privilege):
  * Reads (dashboard, audit, branches, documents list/detail) — any ACTIVE user; SECURITY_ADMIN+ sees cross-branch data.
  * User/key/branch management — SECURITY_ADMIN+.
  * User-create rejects role=OWNER; user-delete refuses OWNER targets and burns the target's sessions.
  * Document upload/decrypt — requireSystemActive (owner bypasses); READONLY is 403; SECURITY_ADMIN+/OWNER may pick any sender branch.
- Known out-of-scope: the frontend (`src/components/*`, `src/app/page.tsx`) still compares `user.role === "ADMIN"` for nav visibility / avatar tint. ESLint doesn't flag it (`no-undef` is off and string-literal comparisons aren't type-checked by eslint), but a future frontend task should update those to the new role enum / `ROLE_RANK` checks.
- Default seeded credentials unchanged: `owner/owner123`, `secadmin/secadmin123`, `dept-a1..dept-c2/<username>`.

---
Task ID: FRONTEND-OWNER-2FA-DEVICES
Agent: general-purpose
Task: Build owner control panel, 2FA enrollment UI, device/license management sections, role-based nav, and update login screen for 2FA.

Work Log:
- Extended `src/lib/types.ts` with the new role hierarchy: exported `Role` (5 values), `ROLE_RANK` (client-safe mirror of the server constant), `roleRank()`/`hasMinRole()` helpers, `UserStatus`, `DeviceRecord`, `LicenseRecord`, `SystemState`/`SystemCounts`/`SystemLicensing`/`SystemStateResponse`, and a `SessionUser` interface matching `/api/auth/me`. Broadened `KeyStatus` to include `DESTROYED`, `DocStatus` to include `PURGED`, and `AuditAction` to include all the new event types (LOGIN, 2FA_*, DEVICE_*, LICENSE_*, USER_*, SYSTEM_*, LOCKDOWN*).
- Updated `src/components/auth-provider.tsx`: `SessionUser` now mirrors the typed shape from `@/lib/types`; `login(username, password, totpCode?, backupCode?)` returns `{ok, requiresTwoFactor?, error?}` so the login screen can flip to the 2FA step when the backend replies `{ok:false, requiresTwoFactor:true}` (no cookie set). The hub-connection effect now joins the exchange hub for both `USER` and `BRANCH_ADMIN` roles (any branch-attached account) instead of just `USER`/`ADMIN`.
- Rewrote `src/components/login-screen.tsx` with a two-step flow: step 1 collects username+password; if the response is `requiresTwoFactor`, step 2 shows a 6-digit `InputOTP` (shadcn/ui) for the TOTP code plus a "Use a backup code" toggle that swaps in an 8-char `XXXX-XXXX` input. Status-keyed errors (suspended / revoked / deactivated / lockdown) are surfaced in an amber warning banner instead of the generic red error banner so users know to contact their administrator. Demo-account hints now show `owner / secadmin / dept-a1 / dept-c2`.
- Created `src/components/sections/twofa.tsx` exporting `Enable2faDialog` and `Disable2faDialog`. The enable dialog runs a 3-step flow: (1) `api.setup2fa()` returns `{secret, otpauthUri, backupCodes[]}` — both the secret and otpauthUri are shown in copyable blocks (no QR library is installed, so we surface text + copy); the 10 single-use backup codes are rendered in a 2-column grid with a strong amber "save these" warning. (2) The user enters a 6-digit code via `InputOTP`. (3) `api.verify2fa(code)` flips `enabled=true`; the dialog toasts and calls `refresh()` so the AuthProvider's user object reflects `twoFactorEnabled: true`. The disable dialog calls `api.disable2fa()` and then `logout()` because the backend burns all sessions on disable.
- Created `src/components/sections/devices.tsx` (SECURITY_ADMIN+): table of devices (name + license, owner, fingerprint, status, last-seen IP+time, created) + "Register Device" dialog (name + PEM textarea with a "Use sample key" prefilled placeholder) + "Revoke" confirmation per device. The fingerprint is shown truncated (click-to-copy). Calls `api.registerDevice`, `api.revokeDevice`, `api.devices`.
- Created `src/components/sections/licenses.tsx` (SECURITY_ADMIN+): table of licenses (licenseKey click-to-copy, device+fingerprint+owner, tier badge, status badge, expires/issued dates, signer fingerprint) + "Issue License" dialog (device select, tier STANDARD/ENTERPRISE/TRIAL, expiry days default 365) which on success shows the issued `licenseKey` + base64 ECDSA signature + signer fingerprint in copyable fields. "Revoke" opens a reason-prompt dialog; "Validate" opens an auto-firing dialog that calls `api.validateLicense(licenseKey, deviceFingerprint)` and shows VALID/INVALID + reason. Tier badges use distinct colors (ENTERPRISE=amber, STANDARD=emerald, TRIAL=slate).
- Created `src/components/sections/system.tsx` (OWNER only): owner control panel with a 4-card status hero (System Active/Deactivated, Lockdown Clear/Active, Users count, Devices/Licenses counts) sourced from `api.systemState()`; a lockdown-active red banner showing who locked it and when; an "Activate System / Deactivate System" toggle and an "Emergency Lockdown / Release Lockdown" toggle (with reason prompt for deactivate/lockdown and an AlertDialog confirm for activate/release); a "Licensing Public Key" panel showing the PEM + SHA-256 fingerprint with copy buttons; and a "Cryptographic Key Destruction" sub-panel that lists every ACTIVE/ROTATED key with a "Destroy Key" button opening an AlertDialog that warns about cryptographic destruction of the private key material + offers an optional "Also purge ciphertext blobs" checkbox — calls `api.revokeKey(id, purgeDocuments?)` and toasts the result with the purge count.
- Updated `src/components/sections/users.tsx`: table now shows distinct columns for Role (color-coded badge per role), Status (ACTIVE/SUSPENDED/REVOKED badge with colored dot), 2FA (shield-check icon when enabled, shield-alert when disabled — with a tooltip showing enforced state), Branch, Created, and Actions. The Add User dialog supports all 5 roles; OWNER is disabled in the Select with an inline "(cannot create)" label. "Suspend" opens a reason-prompt dialog (calls `api.suspendUser(id, true, reason)`); "Reactivate" is a one-click button (calls `api.suspendUser(id, false)`). Suspend/reactivate/delete/reset-password buttons are disabled for OWNER targets and for the current user (delete only). Role badge colors: OWNER=amber/gold, SECURITY_ADMIN=rose, BRANCH_ADMIN=violet, USER=emerald, READONLY=slate.
- Updated `src/components/sections/dashboard.tsx`: added a 3-column row with a `SystemStatusCard` (active/lockdown badges + devices/licenses quick counts + a "Control panel" link for OWNER) and a `SecuritySettingsCard` showing the current user's 2FA status with Enable/Disable buttons that open the `Enable2faDialog` / `Disable2faDialog` from twofa.tsx. Added a "Quick Stats" expansion row showing active devices, active licenses, active users, and total users. Replaced the old indigo `text-indigo-300` in the crypto-stack diagram with `text-emerald-300` to comply with the "never indigo/blue" rule. Updated the `onNavigate` prop type to include all new section ids.
- Updated `src/components/client-ui.tsx`: `UserMenu` now resolves the role icon + color via a `ROLE_BADGE_META` map (OWNER=Crown/amber, SECURITY_ADMIN=ShieldCheck/rose, BRANCH_ADMIN=UserCog/violet, USER=Users/emerald, READONLY=Eye/slate); `NotificationsBell` and `ConnectedClientsPanel` treat both `USER` and `BRANCH_ADMIN` as branch-attached (bell shown, hub-join active) and `SECURITY_ADMIN+` as observing-only. Replaced the old `user.role === "ADMIN"` checks with role-rank/role-meta lookups.
- Updated `src/components/sections/documents.tsx`: replaced the `user?.role === "USER"` identity-lock check with `hasMinRole(user?.role, "SECURITY_ADMIN")` so SECURITY_ADMIN+/OWNER can pick any sender branch while USER/BRANCH_ADMIN/READONLY are locked to their own branch. Removed the `user?.role === "ADMIN"` check.
- Updated `src/app/page.tsx`: added `SectionId` values `"devices"`, `"licenses"`, `"system"`; added NAV entries with `minRole` per item (Dashboard/Documents/Audit visible to all, Branches/Keys/Users/Devices/Licenses SECURITY_ADMIN+, System OWNER-only); added SECTION_TITLES for the three new sections; replaced `user.role === "ADMIN"` with a `hasMinRole()` helper and a `ROLE_HEADER_META` map; the header now shows a red pulsing "LOCKDOWN" badge when `sysState.lockdown` is true, an amber "DEACTIVATED" badge when `!sysState.active`, and a role badge (amber "Owner" for OWNER, rose "Sec Admin" for SECURITY_ADMIN, violet "Branch Admin" for BRANCH_ADMIN) for any SECURITY_ADMIN+ user. The system state is polled every 15s in the background so the header banner reflects emergency changes without requiring navigation. The "System" nav item is amber-tinted to signal its destructive nature.
- Added four thin wrappers to `src/lib/api.ts` to keep the users section typed cleanly: `usersRaw`, `createUserRaw`, `deleteUserRaw`, `resetPasswordRaw` — all returning `{ok, error?, ...}` so the UI can surface server-side error messages without a try/catch. Also retyped `systemState()` to return the strict `SystemStateResponse` from types.ts.
- Fixed `src/components/sections/keys.tsx` `STATUS_META` to include `DESTROYED` (rose, "Destroyed") — required because `KeyStatus` was extended in types.ts.
- Fixed a React 19 `react-hooks/set-state-in-effect` lint error in `ValidateLicenseDialog` by extracting the auto-validating inner content into a keyed `ValidateLicenseInner` component (remounts per `target.id`) so the initial `useState(true)` represents the loading state and all `setState` calls happen inside async promise callbacks rather than synchronously inside the effect body.
- Verified dev server boots (Next.js 16 + Turbopack, Ready in ~700ms), `/` renders the loading splash then the login screen, `/api/auth/login` accepts `{username,password}` and returns the user with `twoFactorEnabled`/`twoFactorEnforced`, `/api/auth/me` returns the user with `status`, `/api/system/state` returns the full state+counts+licensing payload, `/api/2fa/setup` returns secret + otpauthUri + 10 backup codes, and `/api/devices` returns devices with the owning user + license info attached.

Stage Summary:
- ESLint passes clean (exit 0). `bunx tsc --noEmit` reports zero errors in the new frontend files (the only remaining TS error is a pre-existing `Buffer<ArrayBufferLike>` vs `BodyInit` mismatch in `api/documents/[id]/decrypt/route.ts`, out of scope).
- Files created:
  * `src/components/sections/twofa.tsx` (Enable2faDialog, Disable2faDialog)
  * `src/components/sections/devices.tsx` (DevicesSection + Register/Revoke dialogs)
  * `src/components/sections/licenses.tsx` (LicensesSection + Issue/Revoke/Validate dialogs)
  * `src/components/sections/system.tsx` (SystemSection + KeyDestructionPanel)
- Files modified:
  * `src/lib/types.ts` (Role, ROLE_RANK, DeviceRecord, LicenseRecord, SystemState*, SessionUser, expanded AuditAction/KeyStatus/DocStatus)
  * `src/lib/api.ts` (systemState typed, added usersRaw/createUserRaw/deleteUserRaw/resetPasswordRaw)
  * `src/components/auth-provider.tsx` (new SessionUser shape, 2FA-aware login signature, hub joins for USER+BRANCH_ADMIN)
  * `src/components/login-screen.tsx` (two-step 2FA flow + suspended/revoked warning banner)
  * `src/components/sections/users.tsx` (5-role support, status column, 2FA column, suspend/reactivate, role-colored badges)
  * `src/components/sections/dashboard.tsx` (system-status card, security-settings card with 2FA enable/disable, quick-stats row, no indigo/blue)
  * `src/components/sections/keys.tsx` (added DESTROYED status meta)
  * `src/components/sections/documents.tsx` (hasMinRole-based sender locking)
  * `src/components/client-ui.tsx` (role-aware UserMenu + NotificationsBell + ConnectedClientsPanel)
  * `src/app/page.tsx` (9-section nav, role-gated visibility, header lockdown/deactivated badges, role-colored header badge, 15s system-state polling)
- Default seeded credentials unchanged: `owner/owner123`, `secadmin/secadmin123`, `dept-a1..dept-c2/<username>`.

---
Task ID: FINAL-INTEGRATION
Agent: main
Task: Integrate owner system-control APIs, 2FA/device/license APIs, and frontend into a cohesive operational system; verify end-to-end.

Work Log:
- Built owner system-control API routes: /api/system/state (GET), /api/system/activate (POST), /api/system/deactivate (POST, body {reason}), /api/system/lockdown (POST — revokes ALL non-owner sessions + broadcasts hub event), /api/system/release (POST).
- Built /api/users/[id]/suspend (POST {suspend, reason}) — SECURITY_ADMIN+ can suspend any non-OWNER account; suspending revokes all the user's sessions.
- Built /api/keys/[id]/revoke (POST {purgeDocuments}) — OWNER-only cryptographic key destruction: overwrites encrypted private key material, marks DESTROYED, optionally purges ciphertext blobs.
- Added all new endpoints to src/lib/api.ts client.
- Dispatched 3 subagents in parallel:
  * 2FA-DEVICE-LICENSE-APIs: built TOTP 2FA enrollment/verification, device registration/revocation, ECDSA-signed license issuance/revocation/validation. All verified via curl.
  * ROLE-MIGRATION: migrated all 11 existing API routes from removed requireAdmin() to the new 5-role system (OWNER/SECURITY_ADMIN/BRANCH_ADMIN/USER/READONLY) with least-privilege enforcement.
  * FRONTEND-OWNER-2FA-DEVICES: built owner control panel, 2FA enrollment UI, device/license management sections, role-based nav, two-step 2FA login screen.
- Fresh reseed: 14 branches, 28 keys, 12 users (1 owner, 1 secadmin, 3 branch admins, 6 dept users, 1 readonly viewer).

Stage Summary:
- ESLint passes clean.
- Agent Browser end-to-end verification:
  * Owner login → dashboard shows ALL 8 nav items (Dashboard, Documents, Branches, Key Vault, Users, Devices, Licenses, System) + Owner badge. VLM confirmed.
  * USER login (dept-a1) → only 3 nav items (Dashboard, Documents, Audit Log). No admin/owner badge. VLM confirmed.
  * System Control panel renders with Activate/Deactivate, Emergency Lockdown, Key Destruction, Licensing public key.
  * Emergency Lockdown (verified via API): revokes 11 non-owner sessions, dept-a1 login returns 403 during lockdown, login works after release.
  * Devices + Licenses sections render with Register/Issue buttons.
- API verification (curl):
  * Owner login 200, system/state 200 (12 users, 0 devices, 0 licenses fresh), lockdown 200 (sessionsRevoked:11), dept-a1 login 403 during lockdown, release 200, dept-a1 login 200 after release.
  * 2FA: setup → verify → login requires TOTP → login with TOTP succeeds → wrong TOTP 401.
  * Licenses: issue (ECDSA-signed) → validate (correct fingerprint valid:true, wrong fingerprint invalid) → revoke → validate (revoked).
- Both servers running: Next.js on :3000, exchange-hub on :3003.
- Default credentials: owner/owner123 (supreme authority), secadmin/secadmin123, dept-a1..dept-c2/same, sub-a1-viewer/sub-a1-viewer (readonly).
