"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ShieldCheck, Lock, User, Loader2, KeyRound, AlertCircle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Login screen — shown at `/` when no session is present. Each department/section
 * PC or tablet authenticates with a username + password issued by the admin.
 */
export function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Enter your username and password");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await login(username, password);
    setLoading(false);
    if (!res.ok) setError(res.error || "Login failed");
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
          <p className="text-[11px] text-slate-500 mt-2 font-mono">ECC P-521 · AES-256-GCM · ECDSA-SHA512</p>
        </div>

        {/* Login card */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur-xl p-6 shadow-2xl"
        >
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-slate-100">Sign in</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Authenticate with the credentials issued by your system administrator.
            </p>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2.5">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-200">{error}</div>
            </div>
          )}

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

          <Button
            type="submit"
            disabled={loading}
            className="w-full mt-5 bg-emerald-600 hover:bg-emerald-500 text-white h-10"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Authenticating…
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
                <span className="text-amber-400">admin</span> / admin123
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/50 px-2 py-1.5">
                <span className="text-emerald-400">dept-a1</span> / dept-a1
              </div>
            </div>
          </div>
        </form>

        <p className="text-center text-[11px] text-slate-600 mt-6">
          Protected by Elliptic Curve Cryptography · FIPS 140-2 L3
        </p>
      </div>
    </div>
  );
}
