"use client";

import axios from "axios";
import Link from "next/link";
import { useState } from "react";
import Button, { buttonClass } from "@/components/ui/Button";
import { useF1Store } from "@/store/useTelemetryStore";

export default function AccountControl() {
  const { currentUser, setCurrentUser } = useF1Store();
  const [logoutFailed, setLogoutFailed] = useState(false);

  const handleLogout = async () => {
    setLogoutFailed(false);
    try {
      await axios.post("/api/v1/auth/logout");
    } catch (err: any) {
      // 401 means the session was already gone server-side, so we're logged out
      // either way. Anything else (offline, server error) means the session may
      // still be live -- don't pretend otherwise.
      if (err?.response?.status !== 401) {
        setLogoutFailed(true);
        return;
      }
    }
    setCurrentUser(null);
  };

  if (!currentUser) {
    return <Link href="/login" className={buttonClass({ variant: "secondary", size: "sm" })}>Log in</Link>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-[10rem] truncate text-sm text-mute sm:inline" title={currentUser.email}>
        {currentUser.display_name}
      </span>
      <Button size="sm" variant="ghost" onClick={handleLogout}>{logoutFailed ? "Retry log out" : "Log out"}</Button>
      {logoutFailed && (
        <span role="alert" className="hidden text-xs text-live-text lg:inline">
          Couldn't log out. Check your connection and retry.
        </span>
      )}
    </div>
  );
}
