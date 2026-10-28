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

// How often to look for a new session; while one is live, how often to refresh the board (and whether
// it is stopped) and the weather and race control; and the first wait before reconnecting the socket.
export const SESSION_REFRESH_MS = 60_000;
export const LIVE_REFRESH_MS = 3_000;
export const CONDITIONS_REFRESH_MS = 15_000;
export const RECONNECT_MS = 2_000;
const MAX_RECONNECT_MS = 30_000;

// Where the live feed's socket connects: NEXT_PUBLIC_API_URL if set, otherwise this page's host (port 8000
// on localhost). An https page may only open wss:// sockets, so the scheme follows the API's, or the page's.
export function socketBase(apiUrl: string | undefined, page: Pick<Location, "protocol" | "host" | "hostname">): string {
  if (apiUrl) return apiUrl.replace(/^http/, "ws").replace(/\/$/, "");
  if (page.hostname === "localhost") return "ws://localhost:8000";
  return `${page.protocol === "https:" ? "wss" : "ws"}://${page.host}`;
}

export default function AppInitializer({ children }: { children: React.ReactNode }) {
  const activeSession = useF1Store((s) => s.activeSession);
  // Actions never change, so they are read once rather than subscribed to.
  const {
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
    setSessionStatus,
  } = useF1Store.getState();

  const FLAG_SEVERITY: Record<string, "info" | "warning" | "critical"> = {
    RED: "critical",
    "SAFETY CAR": "critical",
    "VIRTUAL SAFETY CAR": "warning",
    YELLOW: "warning",
    GREEN: "info",
    CHEQUERED: "info",
  };

  // Session sync: the running session, else the latest one. Checked again every so often so a
  // session that starts while the page is open goes live (and one that ends stops being live).
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
      if (!cancelled) timer = setTimeout(sync, SESSION_REFRESH_MS);
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

  // A live session's timing changes every few seconds; the sync above only loads it once.
  const liveKey = activeSession?.live === true ? activeSession.session_key : null;
  useEffect(() => {
    setSessionStatus(null);
    if (liveKey == null) return;
    const base = `/api/v1/sessions/${liveKey}`;
    const refreshStatus = () => {
      axios.get(`${base}/status`).then((res) => setSessionStatus(res.data)).catch(() => {});
    };
    const refreshTiming = () => {
      axios.get(`${base}/timing`).then((res) => updateLeaderboard(res.data)).catch(() => {});
      refreshStatus();
    };
    const refreshConditions = () => {
      axios.get(`${base}/weather`).then((res) => {
        if (res.data?.live_signal !== false && res.data?.air_temperature !== undefined) setWeather(res.data);
      }).catch(() => {});
      axios.get(`${base}/race-control`).then((res) => setRaceControlMessages(res.data)).catch(() => {});
    };
    refreshStatus();
    const timing = setInterval(refreshTiming, LIVE_REFRESH_MS);
    const conditions = setInterval(refreshConditions, CONDITIONS_REFRESH_MS);
    return () => {
      clearInterval(timing);
      clearInterval(conditions);
    };
  }, [liveKey]);

  // Connect WebSockets
  useEffect(() => {
    if (!activeSession?.session_key) return;

    const wsUrl = `${socketBase(process.env.NEXT_PUBLIC_API_URL, window.location)}/ws/pitwall-client-${Math.random().toString(36).substring(2, 6)}`;
    
    // The socket drops whenever the backend restarts or the network blips; keep reconnecting
    // (2 s, doubling to 30 s) until the page unmounts, so the feed never stays on standby.
    let socket: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let disposed = false;

    const connect = () => {
      console.log(`Connecting to F1 WebSocket gateway: ${wsUrl}`);
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log("WebSocket connection established");
        attempts = 0;
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
        if (disposed) return;
        retryTimer = setTimeout(connect, Math.min(MAX_RECONNECT_MS, RECONNECT_MS * 2 ** attempts));
        attempts += 1;
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      socket.close();
    };
  }, [activeSession?.session_key]);

  return <>{children}</>;
}
