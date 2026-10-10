import { useState } from "react";
import { Lock, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Sidebar entry: "Admin" (opens sign-in dialog) or "Admin · Sign out". */
export function AdminButton() {
  const { isAdmin, configured, login, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
      setPassword("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => (isAdmin ? logout() : setOpen(true))}
        title={isAdmin ? "Signed in as admin — click to sign out" : "Admin sign-in"}
        className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors w-full"
      >
        {isAdmin ? <ShieldCheck size={16} className="text-primary" /> : <Lock size={16} />}
        <span className="hidden md:block">{isAdmin ? "Admin · Sign out" : "Admin"}</span>
        {isAdmin && <LogOut size={12} className="hidden md:block ml-auto opacity-60" />}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Admin sign-in</DialogTitle>
            <DialogDescription>
              Only the admin can rename, delete or merge albums and delete photos.
            </DialogDescription>
          </DialogHeader>
          {!configured && (
            <p className="text-sm text-destructive">
              Admin login isn't configured on the server (ADMIN_PASSWORD / SESSION_SECRET).
            </p>
          )}
          <form onSubmit={submit} className="space-y-4">
            <Input
              type="password"
              autoFocus
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={!password || busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
