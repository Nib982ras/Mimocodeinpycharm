"use client";

import { useState, useCallback } from "react";
import {
  ShieldCheck,
  Loader2,
  Copy,
  Check,
  AlertTriangle,
  KeyRound,
  Smartphone,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";

/**
 * 2FA enrollment dialog.
 *
 * Flow:
 *  1. User clicks "Enable 2FA" → we call `api.setup2fa()` which returns
 *     `{ secret, otpauthUri, backupCodes[] }`.
 *  2. The dialog shows the secret + otpauth URI (with copy buttons — no QR
 *     library is installed, so we surface the URI as text) and the backup
 *     codes with a strong warning.
 *  3. The user types a 6-digit TOTP code from their authenticator app → we
 *     call `api.verify2fa(code)`. On success we toast and call `refresh()`
 *     so the AuthProvider's user object reflects `twoFactorEnabled: true`.
 *
 * The disable flow is a separate confirmation dialog (`Disable2faDialog`).
 */
export function Enable2faDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { refresh } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<"idle" | "loading" | "enroll" | "verifying">("idle");
  const [secret, setSecret] = useState("");
  const [otpauthUri, setOtpauthUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const begin = useCallback(async () => {
    setStep("loading");
    setError(null);
    try {
      const res = await api.setup2fa();
      setSecret(res.secret);
      setOtpauthUri(res.otpauthUri);
      setBackupCodes(res.backupCodes);
      setStep("enroll");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start 2FA enrollment");
      setStep("idle");
    }
  }, []);

  const verify = useCallback(async () => {
    if (code.length !== 6) {
      setError("Enter the 6-digit code from your authenticator.");
      return;
    }
    setStep("verifying");
    setError(null);
    try {
      await api.verify2fa(code);
      toast({
        title: "2FA enabled",
        description: "Future logins will require a code from your authenticator app.",
      });
      await refresh();
      onOpenChange(false);
      // Reset for next time.
      setStep("idle");
      setSecret("");
      setOtpauthUri("");
      setBackupCodes([]);
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid code");
      setStep("enroll");
    }
  }, [code, refresh, toast, onOpenChange]);

  const close = (o: boolean) => {
    if (o) {
      onOpenChange(true);
      return;
    }
    onOpenChange(false);
    // Reset after the dialog animates out.
    setTimeout(() => {
      setStep("idle");
      setSecret("");
      setOtpauthUri("");
      setBackupCodes([]);
      setCode("");
      setError(null);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <ShieldCheck className="h-5 w-5 text-emerald-400" /> Enable Two-Factor Authentication
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Strengthen your account with a time-based one-time password (TOTP) factor.
          </DialogDescription>
        </DialogHeader>

        {step === "idle" && (
          <div className="py-3 space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
              <Smartphone className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs text-slate-300 space-y-1.5">
                <p>
                  You'll need an authenticator app (Google Authenticator, Authy, 1Password, etc.).
                  We'll generate a TOTP secret and 10 single-use backup codes.
                </p>
                <p className="text-slate-400">
                  From then on, every login requires both your password <em>and</em> a fresh
                  6-digit code (or a backup code if you lose your device).
                </p>
              </div>
            </div>
            {error && (
              <div className="text-xs text-rose-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> {error}
              </div>
            )}
            <Button onClick={begin} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white">
              <KeyRound className="h-4 w-4" /> Begin enrollment
            </Button>
          </div>
        )}

        {step === "loading" && (
          <div className="py-10 flex flex-col items-center gap-3 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
            <span className="text-sm">Generating TOTP secret + backup codes…</span>
          </div>
        )}

        {(step === "enroll" || step === "verifying") && (
          <div className="py-3 space-y-4">
            {/* Secret + otpauthUri */}
            <div className="space-y-2">
              <Label text="Step 1 · Add to your authenticator" />
              <p className="text-[11px] text-slate-400">
                Scan the otpauth URI with your app (or paste the secret manually).
              </p>
              <CopyBlock label="otpauth URI" value={otpauthUri} mono />
              <CopyBlock label="Secret (base32)" value={secret} mono />
            </div>

            {/* Backup codes */}
            <div className="space-y-2">
              <Label text="Step 2 · Save your backup codes" />
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="flex items-start gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-200">
                    Each code is single-use. Store them somewhere safe — they're the only way
                    to recover access if you lose your authenticator device.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
                  {backupCodes.map((c) => (
                    <div key={c} className="rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-amber-300 text-center tracking-wider">
                      {c}
                    </div>
                  ))}
                </div>
                <CopyButton
                  text={backupCodes.join("\n")}
                  label="Copy all codes"
                  className="mt-2"
                />
              </div>
            </div>

            {/* Verify */}
            <div className="space-y-2">
              <Label text="Step 3 · Verify with a 6-digit code" />
              <p className="text-[11px] text-slate-400">
                Type the code currently showing in your authenticator app to confirm enrollment.
              </p>
              <div className="flex justify-center pt-1">
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={(v) => setCode(v.replace(/\D/g, ""))}
                  disabled={step === "verifying"}
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
              {error && (
                <div className="text-xs text-rose-300 flex items-center gap-2 pt-1">
                  <AlertTriangle className="h-4 w-4" /> {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)} className="text-slate-300 hover:bg-slate-800">
                Cancel
              </Button>
              <Button
                onClick={verify}
                disabled={step === "verifying" || code.length !== 6}
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {step === "verifying" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Confirm & Enable
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Confirmation dialog for disabling 2FA on the current user. */
export function Disable2faDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { refresh, logout } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleDisable = async () => {
    setBusy(true);
    try {
      await api.disable2fa();
      toast({
        title: "2FA disabled",
        description: "Your sessions were revoked — please sign in again.",
        variant: "destructive",
      });
      await refresh();
      onOpenChange(false);
      // The backend burns all sessions on 2FA disable; log out proactively
      // so we don't end up with a stale 401 cascade.
      await logout();
    } catch (e) {
      toast({
        title: "Failed to disable 2FA",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-slate-900 border-slate-700 text-slate-100">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-400" /> Disable 2FA?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">
            This will remove the TOTP factor from your account and immediately revoke all
            active sessions. You'll need to sign back in with just your password. Consider
            leaving 2FA on for stronger protection.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700">
            Keep 2FA
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDisable}
            disabled={busy}
            className="bg-rose-600 hover:bg-rose-500 text-white"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Disable & Sign out
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Label({ text }: { text: string }) {
  return (
    <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wide">{text}</div>
  );
}

function CopyBlock({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/50 p-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
        <CopyButton text={value} />
      </div>
      <div className={cn("text-[11px] text-emerald-300 break-all leading-relaxed", mono && "font-mono")}>
        {value}
      </div>
    </div>
  );
}

function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard may be unavailable */
        }
      }}
      className={cn(
        "inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-emerald-300 transition-colors",
        className
      )}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

// Re-export Input for callers that build their own 2FA panels.
export { Input as TwoFaInput };
