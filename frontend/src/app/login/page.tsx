"use client";

import React, { useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { LogIn, UserPlus } from "lucide-react";
import { useF1Store } from "@/store/useTelemetryStore";

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
      setError(err.response?.data?.detail || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full py-4 md:p-8 max-w-md mx-auto space-y-8 animate-fade-in">
      <h1 className="text-3xl font-black italic tracking-tighter text-white uppercase flex items-center gap-3">
        {mode === "login" ? <LogIn className="w-7 h-7 text-f1-red" /> : <UserPlus className="w-7 h-7 text-f1-red" />}
        {mode === "login" ? "Log In" : "Sign Up"}
      </h1>

      <form onSubmit={submit} className="glass-panel p-6 rounded-xl border border-white/5 space-y-4">
        {mode === "signup" && (
          <input
            type="text" placeholder="Display name" value={displayName}
            onChange={(e) => setDisplayName(e.target.value)} required
            className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium"
          />
        )}
        <input
          type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} required
          className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium"
        />
        <input
          type="password" placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)} required
          className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium"
        />
        {error && <p className="text-red-400 text-sm font-titillium">{error}</p>}
        <button
          type="submit" disabled={loading}
          className="w-full bg-f1-red hover:bg-red-700 text-white font-titillium font-bold py-2.5 rounded-md transition-colors disabled:opacity-40"
        >
          {mode === "login" ? "Log In" : "Sign Up"}
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="w-full text-white/50 hover:text-white text-sm font-titillium"
        >
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
        </button>
      </form>
    </div>
  );
}
