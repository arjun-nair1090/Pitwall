"use client";

import React, { useEffect } from "react";
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

// How often to look for a new session, and how often to refresh the board while one is live.
export const SESSION_REFRESH_MS = 60_000;
export const LIVE_REFRESH_MS = 15_000;

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

  // Session sync: the running session, else the latest one. Checked again every so often so a
  // session that starts while the page is open goes live, and while live the board is refreshed.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loadedKey: number | null = null;

    const loadBoard = (key: number) => {
      axios.get(`/api/v1/sessions/${key}/timing`).then((resT) => {
        if (!cancelled) updateLeaderboard(resT.data);
      }).catch(() => {});
      axios.get(`/api/v1/sessions/${key}/weather`).then((resW) => {
        // guard against the live_signal:false sentinel
        if (!cancelled && resW.data?.live_signal !== false && resW.data?.air_temperature !== undefined) {
          setWeather(resW.data);
        }
      }).catch(() => {});
      axios.get(`/api/v1/sessions/${key}/race-control`).then((resR) => {
        if (!cancelled) setRaceControlMessages(resR.data);
      }).catch(() => {});
    };

    const sync = async () => {
      let live = false;
      try {
        const res = await axios.get("/api/v1/sessions/active");
        if (cancelled) return;
        const sess = res.data;
        live = sess.live === true;
        setActiveSession(sess);
        setApiStatus("ok");
        if (live) {
          pushAlert({
            id: `session-${sess.session_key}`,
            severity: "info",
            message: `Session live: ${sess.meeting_name || sess.circuit_short_name || sess.location} ${sess.session_name}`,
            timestamp: Date.now(),
          });
        }
        if (sess.session_key !== loadedKey) {
          loadedKey = sess.session_key;
          axios.get(`/api/v1/sessions/${sess.session_key}/drivers`).then((resD) => {
            if (!cancelled) setDrivers(resD.data);
          }).catch(() => {});
          loadBoard(sess.session_key);
        } else if (live) {
          loadBoard(sess.session_key);
        }
      } catch (err: any) {
        if (cancelled) return;
        // A response (even 404 "no session") means the API is up; no response means it is not.
        setApiStatus(err?.response ? "ok" : "unreachable");
        if (err?.response?.status === 404) {
          setActiveSession(null);
          loadedKey = null;
        }
        if (!err?.response) console.error("Session sync failed", err);
      }
      if (!cancelled) timer = setTimeout(sync, live ? LIVE_REFRESH_MS : SESSION_REFRESH_MS);
    };

    sync();
    // A 401 here just means "not logged in" -- not an error to surface.
    axios
      .get("/api/v1/auth/me")
      .then((res) => setCurrentUser(res.data))
      .catch(() => setCurrentUser(null));

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Connect WebSockets
  useEffect(() => {
    if (!activeSession?.session_key) return;

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

    return () => {
      socket.close();
    };
  }, [activeSession?.session_key]);

  return <>{children}</>;
}
