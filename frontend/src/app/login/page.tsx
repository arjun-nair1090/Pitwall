"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useF1Store } from "@/store/useTelemetryStore";
import { getApiErrorMessage } from "@/lib/apiError";
import PageHeader from "@/components/ui/PageHeader";

export default function LoginPage() {
  const router = useRouter();
  const setCurrentUser = useF1Store((s) => s.setCurrentUser);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    axios.get("/api/v1/auth/providers").then((res) => setGoogle(res.data.google === true)).catch(() => {});
    // The backend sends people back here with ?error= when a Google sign-in didn't go through.
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason === "google") setError("Google sign-in didn't work. Try again, or use your email and password.");
    if (reason === "google_cancelled") setError("Google sign-in was cancelled.");
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const endpoint = mode === "login" ? "/api/v1/auth/login" : "/api/v1/auth/signup";
      const payload = mode === "login" ? { email, password } : { email, password, display_name: displayName };
      const res = await axios.post(endpoint, payload);
      setCurrentUser(res.data);
      router.push("/predictions");
    } catch (err: any) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full py-4 md:p-8 max-w-md mx-auto space-y-8">
      <PageHeader title={mode === "login" ? "Log in" : "Create an account"} />

      {google && (
        <div className="space-y-4">
          {/* A plain link: the backend redirects to Google, so this has to be a full page navigation. */}
          <a
            href="/api/v1/auth/google/start"
            className="flex w-full items-center justify-center gap-3 rounded-panel border border-edge bg-kerb py-2.5 font-bold text-chalk transition-colors hover:border-chalk"
          >
            <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Continue with Google
          </a>
          <p className="text-center text-faint text-xs">or with your email</p>
        </div>
      )}

      <form onSubmit={submit} className="rounded-panel border border-gantry bg-kerb p-6 space-y-4">
        {mode === "signup" && (
          <input
            type="text" placeholder="Display name" aria-label="Display name" value={displayName}
            onChange={(e) => setDisplayName(e.target.value)} required maxLength={50}
            autoComplete="nickname"
            className="w-full bg-kerb border border-edge text-chalk rounded-panel px-4 py-2"
          />
        )}
        <input
          type="email" placeholder="Email" aria-label="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} required maxLength={254}
          autoComplete="email"
          className="w-full bg-kerb border border-edge text-chalk rounded-panel px-4 py-2"
        />
        <div>
          <input
            type="password" placeholder="Password" aria-label="Password" value={password}
            onChange={(e) => setPassword(e.target.value)} required
            minLength={mode === "signup" ? 10 : undefined}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="w-full bg-kerb border border-edge text-chalk rounded-panel px-4 py-2"
          />
          {mode === "signup" && (
            <p className="text-faint text-xs mt-1.5">At least 10 characters. Passwords found in known data breaches are refused.</p>
          )}
        </div>
        {error && <p className="text-live-text text-sm" role="alert">{error}</p>}
        <button
          type="submit" disabled={loading}
          className="w-full bg-chalk text-tarmac hover:bg-white hover:bg-live/90 font-bold py-2.5 rounded-panel transition-colors disabled:opacity-40"
        >
          {mode === "login" ? "Log in" : "Create an account"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError("");
          }}
          className="w-full text-faint hover:text-chalk text-sm"
        >
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
        </button>
      </form>
    </div>
  );
}
