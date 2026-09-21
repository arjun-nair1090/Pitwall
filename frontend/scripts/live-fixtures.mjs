// Serves a realistic live session to the page by intercepting the session endpoints, so /live can be
// exercised (and screenshotted) when no real session is running. Dev-only; nothing here ships.
//   import { installLiveFixtures } from "./live-fixtures.mjs"; await installLiveFixtures(browser);

const DRIVERS = [
  [1, "VER", "Max Verstappen", "Red Bull Racing", "#3671C6"],
  [4, "NOR", "Lando Norris", "McLaren", "#FF8000"],
  [81, "PIA", "Oscar Piastri", "McLaren", "#FF8000"],
  [16, "LEC", "Charles Leclerc", "Ferrari", "#E8002D"],
  [44, "HAM", "Lewis Hamilton", "Ferrari", "#E8002D"],
  [63, "RUS", "George Russell", "Mercedes", "#27F4D2"],
  [12, "ANT", "Kimi Antonelli", "Mercedes", "#27F4D2"],
  [14, "ALO", "Fernando Alonso", "Aston Martin", "#229971"],
  [10, "GAS", "Pierre Gasly", "Alpine", "#FF87BC"],
  [23, "ALB", "Alexander Albon", "Williams", "#64C4FF"],
];

const COMPOUNDS = ["MEDIUM", "HARD", "MEDIUM", "SOFT", "HARD", "MEDIUM", "HARD", "MEDIUM", "SOFT", "HARD"];

function timing() {
  const out = {};
  DRIVERS.forEach(([num], i) => {
    const lap = 81.2 + i * 0.21 + (i === 3 ? -0.9 : 0); // LEC has the fastest lap
    out[String(num)] = {
      position: i + 1,
      lap_number: 14,
      gap_to_leader: i === 0 ? 0 : 1.2 + i * 1.7,
      gap_to_next: i === 0 ? 0 : 1.2 + (i % 3) * 0.4,
      last_lap_time: lap,
      s1: 26.1 + i * 0.05,
      s2: 33.4 + i * 0.07,
      s3: lap - (26.1 + i * 0.05) - (33.4 + i * 0.07),
      compound: COMPOUNDS[i],
      tyre_age: 5 + (i % 4),
      is_pit: false,
    };
  });
  return out;
}

const NOW = Date.now();
const FIXTURES = {
  active: { session_key: 9999, session_name: "Race", circuit_short_name: "Monza", location: "Monza", year: 2026 },
  drivers: DRIVERS.map(([driver_number, code, full_name, team_name, team_color]) => ({
    driver_number, code, first_name: full_name.split(" ")[0], last_name: full_name.split(" ").slice(1).join(" "),
    full_name, team_name, team_color, country_code: "",
  })),
  timing: timing(),
  weather: { air_temperature: 26.7, track_temperature: 31.2, humidity: 62, rainfall: 0, wind_speed: 1.9, wind_direction: 290 },
  raceControl: [
    { timestamp: new Date(NOW - 240000).toISOString(), category: "Flag", message: "GREEN LIGHT - PIT EXIT OPEN", flag: "GREEN" },
    { timestamp: new Date(NOW - 120000).toISOString(), category: "Flag", message: "YELLOW IN TRACK SECTOR 7", flag: "YELLOW" },
    { timestamp: new Date(NOW - 60000).toISOString(), category: "Other", message: "CAR 44 (HAM) TIME 1:20.3 DELETED - TRACK LIMITS AT TURN 4", flag: null },
  ],
  radios: [{ driver_number: 1, timestamp: new Date(NOW - 90000).toISOString(), recording_url: "" }],
  strategy: {
    undercut_threats: [{ leader: "VER", chaser: "NOR", gap: 1.9, severity: "high", reason: "NOR is 1.9s behind VER on older hards and can undercut this lap." }],
    pit_windows: Object.fromEntries(
      DRIVERS.slice(0, 5).map(([, code], i) => [code, {
        driver_code: code, team_name: "", compound: COMPOUNDS[i], tyre_age: 12 + i, estimated_deg_loss_seconds: 0.4 + i * 0.3,
        laps_remaining_in_window: "3-6", status: ["OK", "OPEN", "CRITICAL", "OPEN", "OK"][i],
      }]),
    ),
    safety_car_opportunity: { active: false, reason: "", recommendation: "No safety car expected" },
    weather_warning: { rain_risk: "low", recommendation: "Dry: no rain expected" },
  },
};

// A closed circuit-shaped curve in the same coordinate space as the car positions below.
const TRACK_POINTS = Array.from({ length: 240 }, (_, i) => {
  const t = (i / 240) * Math.PI * 2;
  return { x: Math.round(5200 * Math.cos(t) + 1400 * Math.cos(3 * t)), y: Math.round(3300 * Math.sin(t) + 900 * Math.sin(2 * t)) };
});
FIXTURES.layout = {
  x: TRACK_POINTS.map((p) => p.x),
  y: TRACK_POINTS.map((p) => p.y),
  circuit_name: "Autodromo Nazionale Monza",
  location: "Monza",
};

function bodyFor(url) {
  const path = new URL(url).pathname;
  if (path.endsWith("/layout")) return FIXTURES.layout;
  if (path.endsWith("/sessions/active")) return FIXTURES.active;
  if (path.endsWith("/drivers")) return FIXTURES.drivers;
  if (path.endsWith("/timing")) return FIXTURES.timing;
  if (path.endsWith("/weather")) return FIXTURES.weather;
  if (path.endsWith("/race-control")) return FIXTURES.raceControl;
  if (path.endsWith("/radios")) return FIXTURES.radios;
  if (path.endsWith("/strategy")) return FIXTURES.strategy;
  return null;
}

export async function installLiveFixtures(browser) {
  await browser.send("Fetch.enable", {
    patterns: [
      { urlPattern: "*localhost:8000/api/v1/sessions/*", requestStage: "Request" },
      { urlPattern: "*localhost:8000/api/v1/circuits/*", requestStage: "Request" },
    ],
  });
  browser.on("Fetch.requestPaused", async ({ requestId, request }) => {
    const body = request.method === "GET" ? bodyFor(request.url) : null;
    if (body === null) {
      await browser.send("Fetch.continueRequest", { requestId }).catch(() => {});
      return;
    }
    await browser.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: 200,
      responseHeaders: [
        { name: "Content-Type", value: "application/json" },
        { name: "Access-Control-Allow-Origin", value: "http://localhost:3000" },
        { name: "Access-Control-Allow-Credentials", value: "true" },
      ],
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    }).catch(() => {});
  });
}

// Cars spread around the fixture circuit, as the live gateway would stream them.
export function carFrames() {
  return DRIVERS.map(([driver_number], i) => {
    const p = TRACK_POINTS[Math.floor((i / DRIVERS.length) * TRACK_POINTS.length) % TRACK_POINTS.length];
    return {
      driver_number, timestamp: new Date().toISOString(), x: p.x, y: p.y, z: 0,
      speed: 180 + i * 9, throttle: 60 + i * 3, brake: i % 3 === 0 ? 40 : 0, gear: 4 + (i % 4), rpm: 9000 + i * 350, drs: i % 4 === 0 ? 12 : 0,
    };
  });
}

// Replaces only the app's own gateway socket (Next dev's hot-reload socket must stay real).
export async function installFakeSocket(browser, frames = carFrames()) {
  await browser.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const frames = ${JSON.stringify(frames)};
      const Real = window.WebSocket;
      class Fake {
        constructor(url) {
          this.url = url; this.readyState = 0;
          setTimeout(() => {
            this.readyState = 1; this.onopen && this.onopen({});
            frames.forEach((f, i) => setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(f) }), 50 + i * 15));
          }, 300);
        }
        send() {} close() { this.onclose && this.onclose({}); } addEventListener() {} removeEventListener() {}
      }
      window.WebSocket = function (url, protocols) { return /pitwall-client/.test(url) ? new Fake(url) : new Real(url, protocols); };
      Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    })();`,
  });
}
