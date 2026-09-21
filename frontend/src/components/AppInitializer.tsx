"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { useF1Store } from "@/store/useTelemetryStore";

// Configure default base URL for Axios to communicate with backend
axios.defaults.baseURL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
axios.defaults.withCredentials = true;

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

axios.interceptors.request.use((config) => {
  if (["post", "put", "delete", "patch"].includes((config.method || "").toLowerCase())) {
    const csrfToken = getCookie("csrf_token");
    if (csrfToken) {
      config.headers["X-CSRF-Token"] = csrfToken;
    }
  }
  return config;
});

export default function AppInitializer({ children }: { children: React.ReactNode }) {
  const {
    activeSession,
    setActiveSession,
    setDrivers,
    updateLeaderboard,
    setWeather,
    setRaceControlMessages,
    addRaceControlMessage,
    pushAlert,
    updateTelemetryPoint,
    setIsConnected,
    setApiStatus,
    setCurrentUser,
  } = useF1Store();

  const FLAG_SEVERITY: Record<string, "info" | "warning" | "critical"> = {
    RED: "critical",
    "SAFETY CAR": "critical",
    "VIRTUAL SAFETY CAR": "warning",
    YELLOW: "warning",
    GREEN: "info",
    CHEQUERED: "info",
  };

  const [ws, setWs] = useState<WebSocket | null>(null);

  // Initial Rest sync
  useEffect(() => {
    // 1. Fetch active session metadata
    axios
      .get("/api/v1/sessions/active")
      .then((res) => {
        const sess = res.data;
        setActiveSession(sess);
        pushAlert({
          id: `session-${sess.session_key}`,
          severity: "info",
          message: `Session live: ${sess.session_name} — ${sess.circuit_short_name || sess.location}`,
          timestamp: Date.now(),
        });

        // 2. Fetch session drivers
        axios.get(`/api/v1/sessions/${sess.session_key}/drivers`).then((resD) => {
          setDrivers(resD.data);
        });

        // 3. Fetch timing boards
        axios.get(`/api/v1/sessions/${sess.session_key}/timing`).then((resT) => {
          updateLeaderboard(resT.data);
        });

        // 4. Fetch weather conditions (guard against live_signal:false sentinel)
        axios.get(`/api/v1/sessions/${sess.session_key}/weather`).then((resW) => {
          if (resW.data?.live_signal !== false && resW.data?.air_temperature !== undefined) {
            setWeather(resW.data);
          }
        });

        // 5. Fetch race control feed
        axios.get(`/api/v1/sessions/${sess.session_key}/race-control`).then((resR) => {
          setRaceControlMessages(resR.data);
        });
      })
      .then(() => setApiStatus("ok"))
      .catch((err) => {
        // A response (even 404 "no active session") means the API is up; no response means it is not.
        setApiStatus(err?.response ? "ok" : "unreachable");
        if (!err?.response) console.error("Initialization sync failed", err);
      });

    // A 401 here just means "not logged in" -- not an error to surface.
    axios
      .get("/api/v1/auth/me")
      .then((res) => setCurrentUser(res.data))
      .catch(() => setCurrentUser(null));
  }, []);

  // Connect WebSockets
  useEffect(() => {
    if (!activeSession) return;

    // Use NEXT_PUBLIC_API_URL if configured, otherwise fallback to window locations
    const apiHost = process.env.NEXT_PUBLIC_API_URL 
      ? process.env.NEXT_PUBLIC_API_URL.replace("http://", "").replace("https://", "")
      : (window.location.hostname === "localhost" ? "localhost:8000" : window.location.host);
    const wsUrl = `ws://${apiHost}/ws/pitwall-client-${Math.random().toString(36).substring(2, 6)}`;
    
    console.log(`Connecting to F1 WebSocket gateway: ${wsUrl}`);
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log("WebSocket connection established");
      setIsConnected(true);
    };

    socket.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data);
        // Ignore live_signal:false sentinel frames
        if (frame.live_signal === false) return;
        // Dispatch live packets
        if (frame.driver_number !== undefined) {
          // Telemetry packet containing speed, throttle, x, y, z
          updateTelemetryPoint(frame);
        } else if (frame.air_temperature !== undefined) {
          // Weather packet (check before message to avoid collision)
          setWeather(frame);
        } else if (frame.message !== undefined && frame.category !== undefined) {
          // Race Control / Flags packet (must have category to distinguish from sentinels)
          addRaceControlMessage(frame);
          if (frame.flag) {
            pushAlert({
              id: `flag-${frame.timestamp}-${frame.flag}`,
              severity: FLAG_SEVERITY[frame.flag] || "info",
              message: `${frame.flag} FLAG: ${frame.message}`,
              timestamp: Date.now(),
            });
          }
        }
      } catch (err) {
        // Echo logs
        console.log("WebSocket frame message", event.data);
      }
    };

    socket.onclose = () => {
      console.log("WebSocket connection lost");
      setIsConnected(false);
    };

    setWs(socket);

    return () => {
      socket.close();
    };
  }, [activeSession]);

  return <>{children}</>;
}
