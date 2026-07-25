"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  ShieldCheck,
  Lock,
  User,
  Loader2,
  KeyRound,
  AlertCircle,
  Eye,
  EyeOff,
  Smartphone,
  ArrowLeft,
  Copy,
  Check,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

/**
 * Login screen — shown at `/` when no session is present.
 *
 * Two-step authentication:
 *  1. username + password
 *  2. (only if 2FA enabled) 6-digit TOTP code OR an 8-char backup code
 *
 * The backend never sets a cookie until both factors are confirmed. Suspended /
 * revoked accounts get a 403 with a descriptive message we surface in a warning
 * banner so the user knows to contact their administrator.
 */
export function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusWarn, setStatusWarn] = useState<string | null>(null);

  // 2FA step state
  const [requires2fa, setRequires2fa] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [backupMode, setBackupMode] = useState(false);
  const [backupCode, setBackupCode] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Enter your username and password");
      return;
    }
    setLoading(true);
    setError(null);
    setStatusWarn(null);

    const code = backupMode ? backupCode.trim().toUpperCase() : totpCode.trim();

    const res = await login(username, password, !backupMode && code ? code : undefined, backupMode && code ? code : undefined);
    setLoading(false);

    if (res.ok) return;

    if (res.requiresTwoFactor) {
      setRequires2fa(true);
      setError(null);
      return;
    }

    // Surface suspended / revoked / lockdown / deactivated statuses clearly.
    const msg = res.error || "Login failed";
    if (/suspended|revoked|deactivated|lockdown/i.test(msg)) {
      setStatusWarn(msg);
      setError(null);
    } else {
      setError(msg);
    }
  };

  const reset2fa = () => {
    setRequires2fa(false);
    setTotpCode("");
    setBackupCode("");
    setBackupMode(false);
    setError(null);
    setStatusWarn(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative background grid */}
      <div
        className="absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #1e293b 1px, transparent 1px), linear-gradient(to bottom, #1e293b 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
      <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-teal-500/10 blur-3xl" />

      <div className="relative w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30 mb-4">
            <ShieldCheck className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">SecureExchange</h1>
          <p className="text-sm text-slate-400 mt-1">Secure Multi-Branch Document Exchange</p>
          <p className="text-[11px] text-slate-500 mt-2 font-mono">ECC P-521 · AES-256-GCM · ECDSA-SHA512 · TOTP-2FA</p>
        </div>

        {/* Login card */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur-xl p-6 shadow-2xl"
        >
          <div className="mb-5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-100">
                {requires2fa ? "Two-factor authentication" : "Sign in"}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {requires2fa
                  ? backupMode
                    ? "Enter one of your saved 8-character backup codes."
                    : "Enter the 6-digit code from your authenticator app."
                  : "Authenticate with the credentials issued by your administrator."}
              </p>
            </div>
            {requires2fa && (
              <button
                type="button"
                onClick={reset2fa}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 shrink-0"
              >
                <ArrowLeft className="h-3 w-3" /> Back
              </button>
            )}
          </div>

          {statusWarn && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
              <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-200">{statusWarn}</div>
            </div>
          )}

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2.5">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-200">{error}</div>
            </div>
          )}

          {!requires2fa ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Username</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. dept-a1"
                    autoComplete="username"
                    className="bg-slate-950/60 border-slate-700 text-slate-100 pl-9 placeholder:text-slate-600"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <Input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="bg-slate-950/60 border-slate-700 text-slate-100 pl-9 pr-9 placeholder:text-slate-600"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-center py-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
                  <Smartphone className="h-6 w-6 text-emerald-400" />
                </div>
              </div>

              {!backupMode ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 text-center block">
                    Authenticator code
                  </label>
                  <div className="flex justify-center">
                    <InputOTP
                      maxLength={6}
                      value={totpCode}
                      onChange={(v) => setTotpCode(v.replace(/\D/g, ""))}
                      disabled={loading}
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} className="border-slate-700 bg-slate-950/60 text-slate-100" />
                        <InputOTPSlot index={1} className="border-slate-700 bg-slate-950/60 text-slate-100" />
                        <InputOTPSlot index={2} className="border-slate-700 bg-slate-950/60 text-slate-100" />
                        <InputOTPSlot index={3} className="border-slate-700 bg-slate-950/60 text-slate-100" />
                        <InputOTPSlot index={4} className="border-slate-700 bg-slate-950/60 text-slate-100" />
                        <InputOTPSlot index={5} className="border-slate-700 bg-slate-950/60 text-slate-100" />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  <p className="text-[11px] text-slate-500 text-center mt-2">
                    Enter the 6-digit code from your authenticator app (Google Authenticator, Authy, 1Password, etc.).
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 block">Backup code</label>
                  <Input
                    value={backupCode}
                    onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                    placeholder="ABCD-EFGH"
                    className="bg-slate-950/60 border-slate-700 text-slate-100 font-mono tracking-widest text-center"
                    disabled={loading}
                    autoFocus
                  />
                  <p className="text-[11px] text-slate-500 text-center mt-1">
                    Each backup code is single-use. You saved these when you enrolled.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setBackupMode((v) => !v);
                    setError(null);
                    setStatusWarn(null);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-emerald-300"
                >
                  <KeyRound className="h-3 w-3" />
                  {backupMode ? "Use authenticator code" : "Use a backup code"}
                </button>
                <Copy2faHint />
              </div>
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="w-full mt-5 bg-emerald-600 hover:bg-emerald-500 text-white h-10"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Authenticating…
              </>
            ) : requires2fa ? (
              <>
                <ShieldCheck className="h-4 w-4" /> Verify & Sign in
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4" /> Sign in securely
              </>
            )}
          </Button>

          <div className="mt-5 pt-4 border-t border-slate-800">
            <p className="text-[11px] text-slate-500 text-center mb-2">Demo accounts</p>
            <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
              <div className="rounded-md border border-slate-800 bg-slate-950/50 px-2 py-1.5">
                <span className="text-amber-400">owner</span> / owner123
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/50 px-2 py-1.5">
                <span className="text-rose-400">secadmin</span> / secadmin123
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/50 px-2 py-1.5">
                <span className="text-emerald-400">dept-a1</span> / dept-a1
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/50 px-2 py-1.5">
                <span className="text-slate-300">dept-c2</span> / dept-c2
              </div>
            </div>
          </div>
        </form>

        <p className="text-center text-[11px] text-slate-600 mt-6">
          Protected by Elliptic Curve Cryptography · FIPS 140-2 L3 · TOTP-2FA
        </p>
      </div>
    </div>
  );
}

/** Tiny inline hint shown in the 2FA step footer — copy the current TOTP code
 *  to clipboard if it's been typed (mostly for screen-reader convenience). */
function Copy2faHint() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.readText();
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore — clipboard may be unavailable */
        }
      }}
      className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      Paste from clipboard
    </button>
  );
}
