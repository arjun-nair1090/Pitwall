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

export interface HistoricalRace {
  year: number;
  round: string;
  raceName: string;
  circuitName: string;
  locality: string;
  country: string;
  date: string;
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

interface F1StoreState {
  activeSession: any | null;
  historicalRace: HistoricalRace | null;
  replaySession: { year: number, gp: string, lap?: number } | null;
  drivers: any[];
  leaderboard: Record<string, TimingDriver>;
  telemetry: Record<number, DriverTelemetry>;
  weather: WeatherData | null;
  raceControl: RaceControlMessage[];
  isConnected: boolean;
  liveSignal: boolean;
  selectedDriverNum: number | null;
  
  replayPlayback: {
    isPlaying: boolean;
    speed: number;
    frame: number;
    maxFrame: number;
    currentLap?: number;
    totalLaps?: number;
  };
  setReplayPlayback: (playback: Partial<{ isPlaying: boolean; speed: number; frame: number; maxFrame: number; currentLap: number; totalLaps: number; }>) => void;
  setActiveSession: (session: any) => void;
  setHistoricalRace: (race: HistoricalRace | null) => void;
  setReplaySession: (replay: { year: number, gp: string, lap?: number } | null) => void;
  setDrivers: (drivers: any[]) => void;
  updateLeaderboard: (leaderboard: Record<string, TimingDriver>) => void;
  updateTelemetryPoint: (point: DriverTelemetry) => void;
  setWeather: (weather: WeatherData) => void;
  addRaceControlMessage: (msg: RaceControlMessage) => void;
  setRaceControlMessages: (msgs: RaceControlMessage[]) => void;
  setIsConnected: (status: boolean) => void;
  setLiveSignal: (signal: boolean) => void;
  setSelectedDriverNum: (num: number | null) => void;
}

export const useF1Store = create<F1StoreState>((set) => ({
  activeSession: null,
  historicalRace: null,
  replaySession: null,
  drivers: [],
  leaderboard: {},
  telemetry: {},
  weather: null,
  raceControl: [],
  isConnected: false,
  liveSignal: true,
  selectedDriverNum: null,
  replayPlayback: { isPlaying: true, speed: 1, frame: 0, maxFrame: 0 },
  setReplayPlayback: (playback) => set((state) => ({ replayPlayback: { ...state.replayPlayback, ...playback } })),
  setActiveSession: (session) => set({ activeSession: session }),
  setHistoricalRace: (race) => set({ historicalRace: race }),
  setReplaySession: (replay) => set({ replaySession: replay }),
  setDrivers: (drivers) => set({ drivers }),
  updateLeaderboard: (leaderboard) => set({ leaderboard }),
  updateTelemetryPoint: (point) => set((state) => ({
    telemetry: { ...state.telemetry, [point.driver_number]: point }
  })),
  setWeather: (weather) => set({ weather }),
  addRaceControlMessage: (msg) => set((state) => ({
    raceControl: [msg, ...state.raceControl].slice(0, 50)
  })),
  setRaceControlMessages: (msgs) => set({ raceControl: msgs }),
  setIsConnected: (status) => set({ isConnected: status }),
  setLiveSignal: (signal) => set({ liveSignal: signal }),
  setSelectedDriverNum: (num) => set({ selectedDriverNum: num }),
}));
