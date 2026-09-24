"use client";

import React, { useState } from "react";
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
            minLength={mode === "signup" ? 8 : undefined}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="w-full bg-kerb border border-edge text-chalk rounded-panel px-4 py-2"
          />
          {mode === "signup" && (
            <p className="text-faint text-xs mt-1.5">At least 8 characters.</p>
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
