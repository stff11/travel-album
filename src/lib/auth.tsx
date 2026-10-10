import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Admin session state.
 *
 * Only the admin may edit or delete (rename/delete albums, merge, delete photos,
 * change cover). Anyone can browse and upload. The server enforces this; the
 * UI just hides the controls the server would reject.
 */

type AuthState = {
  isAdmin: boolean;
  /** false when the server has no ADMIN_PASSWORD configured */
  configured: boolean;
  isLoading: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Call when the API answers 401 so the UI drops back to read-only. */
  handleUnauthorized: () => void;
};

const AUTH_KEY = ["/api/auth/me"] as const;

const AuthContext = createContext<AuthState | null>(null);

async function fetchMe(): Promise<{ isAdmin: boolean; configured: boolean }> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!res.ok) return { isAdmin: false, configured: true };
  return res.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: AUTH_KEY,
    queryFn: fetchMe,
    staleTime: 5 * 60_000,
  });

  const login = useCallback(
    async (password: string) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Login failed");
      }
      queryClient.setQueryData(AUTH_KEY, { isAdmin: true, configured: true });
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    queryClient.setQueryData(AUTH_KEY, { isAdmin: false, configured: true });
  }, [queryClient]);

  const handleUnauthorized = useCallback(() => {
    queryClient.setQueryData(AUTH_KEY, { isAdmin: false, configured: true });
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      isAdmin: data?.isAdmin ?? false,
      configured: data?.configured ?? true,
      isLoading,
      login,
      logout,
      handleUnauthorized,
    }),
    [data, isLoading, login, logout, handleUnauthorized],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** True if an error thrown by the API client is an HTTP 401. */
export function isUnauthorized(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: number }).status === 401;
}
