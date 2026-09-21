import { create } from 'zustand';

export interface DriverTelemetry {
  driver_number: number;
  timestamp: string;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  drs: number;
  x: number;
  y: number;
  z: number;
  live_signal?: boolean;
}

export interface TimingDriver {
  position?: number;
  lap_number?: number;
  gap_to_leader?: number;
  gap_to_next?: number;
  last_lap_time?: number;
  s1?: number;
  s2?: number;
  s3?: number;
  compound?: string;
  tyre_age?: number;
  is_pit?: boolean;
}

export interface WeatherData {
  air_temperature: number;
  track_temperature: number;
  humidity: number;
  rainfall: number;
  wind_speed: number;
  wind_direction: number;
}

export interface RaceControlMessage {
  timestamp: string;
  category: string;
  message: string;
  flag?: string;
}

export interface GapHistoryPoint {
  lap: number;
  gaps: Record<string, number | null>;
}

export interface LiveAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
  timestamp: number;
}

export interface CurrentUser {
  id: number;
  email: string;
  display_name: string;
}

interface F1StoreState {
  activeSession: any | null;
  drivers: any[];
  leaderboard: Record<string, TimingDriver>;
  gapHistory: GapHistoryPoint[];
  telemetry: Record<number, DriverTelemetry>;
  weather: WeatherData | null;
  raceControl: RaceControlMessage[];
  alerts: LiveAlert[];
  isConnected: boolean;
  // Whether the API itself answered. Distinct from isConnected (the live feed): between race weekends
  // the API is fine and there is simply no live session.
  apiStatus: "unknown" | "ok" | "unreachable";
  liveSignal: boolean;
  selectedDriverNum: number | null;
  currentUser: CurrentUser | null;

  setActiveSession: (session: any) => void;
  setDrivers: (drivers: any[]) => void;
  updateLeaderboard: (leaderboard: Record<string, TimingDriver>) => void;
  updateTelemetryPoint: (point: DriverTelemetry) => void;
  setWeather: (weather: WeatherData) => void;
  addRaceControlMessage: (msg: RaceControlMessage) => void;
  setRaceControlMessages: (msgs: RaceControlMessage[]) => void;
  pushAlert: (alert: LiveAlert) => void;
  dismissAlert: (id: string) => void;
  setIsConnected: (status: boolean) => void;
  setApiStatus: (status: "unknown" | "ok" | "unreachable") => void;
  setLiveSignal: (signal: boolean) => void;
  setSelectedDriverNum: (num: number | null) => void;
  setCurrentUser: (user: CurrentUser | null) => void;
}

export const useF1Store = create<F1StoreState>((set) => ({
  activeSession: null,
  drivers: [],
  leaderboard: {},
  gapHistory: [],
  telemetry: {},
  weather: null,
  raceControl: [],
  alerts: [],
  isConnected: false,
  apiStatus: "unknown",
  liveSignal: true,
  selectedDriverNum: null,
  currentUser: null,
  setActiveSession: (session) => set({ activeSession: session }),
  setDrivers: (drivers) => set({ drivers }),
  updateLeaderboard: (leaderboard) => set((state) => {
    // Sample gap history once per lap (not on every tick) so a race's worth of
    // history stays a few dozen points, not thousands of near-duplicate ticks.
    const maxLap = Math.max(0, ...Object.values(leaderboard).map((t) => t.lap_number || 0));
    const lastPoint = state.gapHistory[state.gapHistory.length - 1];
    if (maxLap > 0 && maxLap !== lastPoint?.lap) {
      const gaps: Record<string, number | null> = {};
      Object.entries(leaderboard).forEach(([num, t]) => {
        gaps[num] = t.gap_to_leader ?? null;
      });
      const gapHistory = [...state.gapHistory, { lap: maxLap, gaps }].slice(-100);
      return { leaderboard, gapHistory };
    }
    return { leaderboard };
  }),
  updateTelemetryPoint: (point) => set((state) => ({
    telemetry: { ...state.telemetry, [point.driver_number]: point }
  })),
  setWeather: (weather) => set({ weather }),
  addRaceControlMessage: (msg) => set((state) => ({
    raceControl: [msg, ...state.raceControl].slice(0, 50)
  })),
  setRaceControlMessages: (msgs) => set({ raceControl: msgs }),
  // An id identifies one event ("session-9999", "flag-<time>-<flag>"), so a repeat of a showing alert
  // is ignored rather than stacked (React StrictMode runs the initial sync effect twice in dev).
  pushAlert: (alert) =>
    set((state) =>
      state.alerts.some((a) => a.id === alert.id) ? state : { alerts: [alert, ...state.alerts].slice(0, 8) },
    ),
  dismissAlert: (id) => set((state) => ({ alerts: state.alerts.filter((a) => a.id !== id) })),
  setIsConnected: (status) => set({ isConnected: status }),
  setApiStatus: (status) => set({ apiStatus: status }),
  setLiveSignal: (signal) => set({ liveSignal: signal }),
  setSelectedDriverNum: (num) => set({ selectedDriverNum: num }),
  setCurrentUser: (user) => set({ currentUser: user }),
}));
