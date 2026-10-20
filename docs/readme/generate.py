"""Draws the animated README graphics in docs/readme from real telemetry.

Run it with the backend up: python docs/readme/generate.py
It asks the local API for Verstappen and Leclerc's best laps from qualifying at Spa in 2024.
"""
import bisect
import json
import math
import os
import urllib.request

OUT = os.path.dirname(os.path.abspath(__file__))
API = os.environ.get("PITWALL_API", "http://localhost:8000/api/v1")

BG, KERB, RAISED, GANTRY, EDGE = "#15151E", "#1E1E2A", "#282836", "#38384A", "#7C7C92"
CHALK, MUTE, FAINT = "#F0F0F5", "#ACACBE", "#9292A6"
PURPLE, GREEN, YELLOW, RED = "#B57BFF", "#35D07F", "#F6C945", "#E10600"
FONT = "'Titillium Web','Barlow Semi Condensed','Arial Narrow','Helvetica Neue',Arial,sans-serif"
ROT = 250

request = urllib.request.Request(
    f"{API}/telemetry/compare",
    data=json.dumps({"year": 2024, "round": 14, "session": "Q", "driver1": "VER", "driver2": "LEC"}).encode(),
    headers={"Content-Type": "application/json"},
)
duel = json.load(urllib.request.urlopen(request, timeout=600))
A, B = duel["driver1"], duel["driver2"]  # VER, LEC


def rotate(x, y):
    r = math.radians(ROT)
    return x * math.cos(r) - y * math.sin(r), x * math.sin(r) + y * math.cos(r)


class Fit:
    """Maps track coordinates into a box, keeping the aspect ratio, centred."""

    def __init__(self, pts, x0, y0, w, h):
        rp = [rotate(*p) for p in pts]
        self.minx, self.maxx = min(p[0] for p in rp), max(p[0] for p in rp)
        self.miny, self.maxy = min(p[1] for p in rp), max(p[1] for p in rp)
        self.s = min(w / (self.maxx - self.minx), h / (self.maxy - self.miny))
        self.ox = x0 + (w - (self.maxx - self.minx) * self.s) / 2
        self.oy = y0 + (h - (self.maxy - self.miny) * self.s) / 2

    def __call__(self, x, y):
        rx, ry = rotate(x, y)
        return self.ox + (rx - self.minx) * self.s, self.oy + (self.maxy - ry) * self.s


def thin(tel, step):
    out = [tel[0]]
    for p in tel[1:]:
        if p["distance"] - out[-1]["distance"] >= step:
            out.append(p)
    return out


def track(fit, tel):
    """SVG path through the lap, and each point's share of the path length."""
    pts = [fit(p["x"], p["y"]) for p in tel]
    lengths = [0.0]
    for a, b in zip(pts, pts[1:]):
        lengths.append(lengths[-1] + math.dist(a, b))
    total = lengths[-1]
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    return d, [l / total for l in lengths]


def interp(xs, ys, x):
    i = bisect.bisect_left(xs, x)
    if i <= 0:
        return ys[0]
    if i >= len(xs):
        return ys[-1]
    t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]) if xs[i] != xs[i - 1] else 0
    return ys[i - 1] + t * (ys[i] - ys[i - 1])


def motion_keys(tel, ref_tel, ref_frac, lap_time, cycle_lap, n=90):
    """keyTimes/keyPoints for a car following `tel` on the path built from `ref_tel`.
    Time runs 0..lap_time inside a cycle of `cycle_lap` seconds of lap time (the rest is a pause)."""
    total = tel[-1]["distance"]
    ref_total = ref_tel[-1]["distance"]
    ref_d = [p["distance"] / ref_total for p in ref_tel]
    times, points = [], []
    sampled = [tel[round(i * (len(tel) - 1) / n)] for i in range(n + 1)]
    for p in sampled:
        t = p["time"] / cycle_lap
        frac = interp(ref_d, ref_frac, p["distance"] / total)
        if times and t <= times[-1]:
            continue
        times.append(t)
        points.append(min(max(frac, 0), 1))
    times[0], points[0] = 0.0, 0.0
    end = lap_time / cycle_lap
    if times[-1] < end:
        times.append(end)
        points.append(1.0)
    else:
        times[-1], points[-1] = end, 1.0
    if end < 1:
        times.append(1.0)
        points.append(1.0)
    return ";".join(f"{t:.4f}" for t in times), ";".join(f"{p:.4f}" for p in points)


def svg(w, h, body, title, desc=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" '
            f'aria-labelledby="t d"><title id="t">{title}</title><desc id="d">{desc}</desc>{body}</svg>\n')


REDUCED = "@media (prefers-reduced-motion: reduce){*{animation:none!important}}"
GLOW = ('<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/>'
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
        '<filter id="bigglow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="10"/></filter>')


def backdrop(w, h):
    return (f'<rect width="{w}" height="{h}" fill="{BG}"/>'
            f'<rect width="{w}" height="{h}" fill="url(#carbon)"/>'
            f'<rect width="{w}" height="{h}" fill="url(#vignette)"/>')


DEFS_COMMON = (
    '<pattern id="carbon" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
    f'<rect width="4" height="8" fill="{CHALK}" opacity="0.018"/></pattern>'
    '<radialGradient id="vignette" cx="30%" cy="0%" r="90%"><stop offset="0" stop-color="#E10600" stop-opacity="0.13"/>'
    '<stop offset="0.5" stop-color="#E10600" stop-opacity="0"/></radialGradient>'
)


# --- Hero -----------------------------------------------------------------------------------------

def hero():
    W, H = 1200, 520
    tel = thin(A["telemetry"], 18)
    fit = Fit([(p["x"], p["y"]) for p in tel], 800, 190, 360, 220)
    d, frac = track(fit, tel)
    cycle = A["lap_time"] + 4
    kt, kp = motion_keys(A["telemetry"], tel, frac, A["lap_time"], A["lap_time"])
    dur = A["lap_time"] / 7.5

    # A train of cars on the same lap, a few seconds apart, so they bunch in the corners.
    field = [("#3671C6", 0.0), ("#FF8000", 2.7), ("#E80020", 4.8), ("#27F4D2", 7.5), ("#FF8000", 9.3), ("#E80020", 13.2)]
    cars = ""
    for colour, gap in field:
        begin = -(gap / 7.5)
        cars += (f'<g filter="url(#glow)"><circle r="6.5" fill="{colour}" stroke="{BG}" stroke-width="2">'
                 f'<animateMotion dur="{dur:.2f}s" begin="{begin:.2f}s" repeatCount="indefinite" calcMode="linear" '
                 f'keyTimes="{kt}" keyPoints="{kp}"><mpath href="#spa"/></animateMotion></circle></g>')

    # Five lights, one a beat, then all out.
    lights, css = "", []
    period, beat, out_at = 7.0, 0.75, 4.9
    for i in range(5):
        x = 810 + i * 68
        on = (0.4 + i * beat) / period * 100
        off = out_at / period * 100
        css.append(f"@keyframes l{i}{{0%,{on - 0.01:.2f}%{{opacity:0}}{on:.2f}%,{off - 0.01:.2f}%{{opacity:1}}{off:.2f}%,100%{{opacity:0}}}}"
                   f".l{i}{{animation:l{i} {period}s infinite}}")
        lights += (f'<rect x="{x}" y="46" width="54" height="104" rx="6" fill="#0B0B10" stroke="{GANTRY}"/>'
                   f'<circle cx="{x + 27}" cy="74" r="17" fill="#1C1C26"/><circle cx="{x + 27}" cy="122" r="17" fill="#2A0D0D"/>'
                   f'<g class="l{i}"><circle cx="{x + 27}" cy="122" r="22" fill="{RED}" opacity="0.55" filter="url(#bigglow)"/>'
                   f'<circle cx="{x + 27}" cy="122" r="17" fill="{RED}"/><circle cx="{x + 21}" cy="116" r="5" fill="#FF8A80" opacity="0.8"/></g>')
    go = out_at / period * 100
    css.append(f"@keyframes go{{0%,{go - 0.01:.2f}%{{opacity:0;transform:translateX(-14px)}}{go + 2:.2f}%{{opacity:1;transform:none}}"
               f"{go + 22:.2f}%{{opacity:1}}{go + 26:.2f}%,100%{{opacity:0}}}}.go{{animation:go {period}s infinite}}")

    chips = ["LIVE TIMING", "PIT WINDOW", "WIN PROBABILITY", "TITLE ODDS"]
    chip_svg, x = "", 64
    for i, c in enumerate(chips):
        w = 22 + len(c) * 9.6
        chip_svg += (f'<g class="chip" style="animation-delay:{1.6 + i * 0.18:.2f}s">'
                     f'<rect x="{x}" y="318" width="{w:.0f}" height="30" fill="{KERB}" stroke="{GANTRY}"/>'
                     f'<rect x="{x}" y="318" width="3" height="30" fill="{RED}"/>'
                     f'<text x="{x + 13}" y="338" font-size="13" font-weight="700" letter-spacing="1.4" fill="{MUTE}">{c}</text></g>')
        x += w + 10

    ticker_items = ["LIVE TIMING", "TRACK MAP", "BATTLES AND PIT STOPS", "HEAD TO HEAD", "CORNER BY CORNER", "RACE PACE",
                    "STRATEGY SIMULATOR", "PIT WINDOW", "WIN PROBABILITY", "CHAMPIONSHIP ODDS", "OVERTAKES", "RACE DEBRIEF",
                    "ASK THE DATA", "PREDICTIONS"]
    ticker_text = "".join(f'<tspan fill="{CHALK}">{t}</tspan><tspan fill="{RED}" font-weight="900">  /  </tspan>' for t in ticker_items)
    TL = 2200

    speed_lines = "".join(
        f'<rect class="streak" style="animation-delay:{i * 0.37:.2f}s" x="0" y="{132 + i * 16}" width="{120 + (i * 53) % 140}" height="{2 if i % 2 else 3}" fill="{RED}"/>'
        for i in range(6))

    style = (
        "<style>"
        f"text{{font-family:{FONT}}}"
        ".bar{transform-box:fill-box;transform-origin:left;animation:bar 1.1s cubic-bezier(.2,.8,.2,1) both}"
        "@keyframes bar{from{transform:scaleX(0)}}"
        ".draw{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 2.4s .3s ease-out forwards}"
        "@keyframes draw{to{stroke-dashoffset:0}}"
        ".flow{stroke-dasharray:.012 .03;animation:flow 6s linear infinite}"
        "@keyframes flow{to{stroke-dashoffset:-1}}"
        ".type{transform-box:fill-box;transform-origin:left;animation:type 2.2s .5s steps(46) both}"
        "@keyframes type{from{transform:scaleX(0)}}"
        ".caret{animation:blink 1s steps(1) infinite}@keyframes blink{50%{opacity:0}}"
        ".chip{opacity:0;animation:chip .5s ease-out forwards}@keyframes chip{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}"
        ".rise{animation:rise .9s cubic-bezier(.2,.8,.2,1) both}@keyframes rise{from{opacity:0;transform:translateY(24px)}}"
        ".streak{opacity:0;animation:streak 2.2s linear infinite}"
        "@keyframes streak{0%{opacity:0;transform:translateX(-200px)}15%{opacity:.9}60%{opacity:0;transform:translateX(560px)}100%{opacity:0;transform:translateX(560px)}}"
        f".tick{{animation:tick 38s linear infinite}}@keyframes tick{{to{{transform:translateX(-{TL}px)}}}}"
        ".live{animation:pulse 1.4s ease-in-out infinite}@keyframes pulse{50%{opacity:.25}}"
        + "".join(css) + REDUCED +
        "</style>"
    )
    defs = (
        f"<defs>{DEFS_COMMON}{GLOW}"
        f'<linearGradient id="sweep" x1="0" x2="1"><stop offset="0" stop-color="{RED}" stop-opacity="0"/>'
        f'<stop offset="0.5" stop-color="{RED}" stop-opacity="1"/><stop offset="1" stop-color="{RED}" stop-opacity="0"/></linearGradient>'
        '<linearGradient id="shine" gradientUnits="userSpaceOnUse" x1="-400" x2="0" y1="0" y2="0">'
        f'<stop offset="0" stop-color="{CHALK}" stop-opacity="0"/><stop offset="0.5" stop-color="#FF3B30" stop-opacity="1"/>'
        f'<stop offset="1" stop-color="{CHALK}" stop-opacity="0"/>'
        '<animateTransform attributeName="gradientTransform" type="translate" values="0;1500" dur="4.5s" repeatCount="indefinite"/>'
        "</linearGradient>"
        '<clipPath id="typeclip"><rect class="type" x="64" y="262" width="640" height="40"/></clipPath>'
        f'<clipPath id="tickclip"><rect x="0" y="462" width="{W}" height="58"/></clipPath>'
        "</defs>"
    )
    body = (
        style + defs + backdrop(W, H)
        + f'<rect class="bar" x="0" y="0" width="{W}" height="6" fill="{RED}"/>'
        + f'<g class="rise"><circle class="live" cx="70" cy="70" r="5" fill="{RED}"/>'
          f'<text x="84" y="75" font-size="14" font-weight="700" letter-spacing="3" fill="{MUTE}">FORMULA 1 TIMING  ·  2018 TO NOW</text></g>'
        + f'<g>{speed_lines}</g>'
        + f'<g class="rise" style="animation-delay:.15s"><path d="M64 128 h36 l-30 116 h-36 z" fill="{RED}"/>'
          f'<text x="100" y="230" font-size="116" font-weight="900" font-style="italic" letter-spacing="-2" fill="{CHALK}">PIT WALL</text>'
          f'<text x="100" y="230" font-size="116" font-weight="900" font-style="italic" letter-spacing="-2" fill="url(#shine)" opacity="0.85">PIT WALL</text></g>'
        + f'<g clip-path="url(#typeclip)"><text x="64" y="290" font-size="26" fill="{MUTE}">The timing screen, for every grand prix since 2018.</text></g>'
        + chip_svg
        + f'<text x="64" y="392" font-size="15" fill="{FAINT}">Built on FastF1 and F1\'s own live timing feed. Numbers come from code, never a language model.</text>'
        + lights
        + f'<g class="go"><text x="980" y="182" text-anchor="middle" font-size="20" font-weight="900" font-style="italic" letter-spacing="4" fill="{CHALK}">LIGHTS OUT</text></g>'
        + f'<path d="{d}" fill="none" stroke="#0B0B10" stroke-width="16" stroke-linejoin="round"/>'
        + f'<path d="{d}" fill="none" stroke="{GANTRY}" stroke-width="9" stroke-linejoin="round" pathLength="1" class="draw"/>'
        + f'<path id="spa" d="{d}" fill="none" stroke="{EDGE}" stroke-width="1.6" pathLength="1" class="flow" opacity="0.8"/>'
        + cars
        + f'<text x="1150" y="436" text-anchor="end" font-size="12" font-weight="700" letter-spacing="2.5" fill="{FAINT}">SPA-FRANCORCHAMPS  ·  REAL LAP, 7.5x</text>'
        + f'<rect x="0" y="462" width="{W}" height="58" fill="#0E0E14"/><rect x="0" y="462" width="{W}" height="1" fill="{GANTRY}"/>'
        + f'<g clip-path="url(#tickclip)"><g class="tick">'
          f'<text x="0" y="498" font-size="16" font-weight="700" letter-spacing="2" textLength="{TL}" lengthAdjust="spacing">{ticker_text}</text>'
          f'<text x="{TL}" y="498" font-size="16" font-weight="700" letter-spacing="2" textLength="{TL}" lengthAdjust="spacing">{ticker_text}</text>'
          "</g></g>"
    )
    return svg(W, H, body, "Pit Wall", "Animated title: five start lights go out while cars lap a real Spa-Francorchamps outline.")


# --- Two laps, replayed -----------------------------------------------------------------------------

def duel_svg():
    W, H = 1200, 600
    ta = thin(A["telemetry"], 15)
    fit = Fit([(p["x"], p["y"]) for p in ta], 40, 120, 500, 380)
    d, frac = track(fit, ta)
    slow = 7.0
    cycle_lap = B["lap_time"] + 5.0  # lap time of the slower car, plus a pause at the line
    dur = cycle_lap / slow
    kta, kpa = motion_keys(A["telemetry"], ta, frac, A["lap_time"], cycle_lap, n=120)
    ktb, kpb = motion_keys(B["telemetry"], ta, frac, B["lap_time"], cycle_lap, n=120)

    # Corner numbers, nudged off the racing line.
    corners = ""
    for c in duel["corners"]:
        cx, cy = fit(c["x"], c["y"])
        corners += f'<text x="{cx:.0f}" y="{cy - 12:.0f}" text-anchor="middle" font-size="10" font-weight="700" fill="{FAINT}">{c["number"]}</text>'

    # Speed traces against distance; each draws in step with its own car.
    cx0, cy0, cw, ch = 610, 128, 550, 250
    vmax = 340

    def trace(tel):
        total = tel[-1]["distance"]
        pts = thin(tel, 12)
        return "M" + " L".join(f"{cx0 + p['distance'] / total * cw:.1f},{cy0 + ch - p['speed'] / vmax * ch:.1f}" for p in pts)

    def reveal_keys(tel, lap_time, n=120):
        total = tel[-1]["distance"]
        sampled = [tel[round(i * (len(tel) - 1) / n)] for i in range(n + 1)]
        times, offs = [], []
        for p in sampled:
            t = p["time"] / cycle_lap
            if times and t <= times[-1]:
                continue
            times.append(t)
            offs.append(p["distance"] / total * cw)
        times[0], offs[0] = 0.0, 0.0
        times.append(lap_time / cycle_lap)
        offs.append(cw)
        times.append(1.0)
        offs.append(cw)
        return ";".join(f"{t:.4f}" for t in times), ";".join(f"{o:.1f}" for o in offs)

    dka, dva = reveal_keys(A["telemetry"], A["lap_time"])
    dkb, dvb = reveal_keys(B["telemetry"], B["lap_time"])

    def clip(cid, keys, vals):
        return (f'<clipPath id="{cid}"><rect x="{cx0}" y="0" width="0" height="{H}">'
                f'<animate attributeName="width" dur="{dur:.3f}s" repeatCount="indefinite" calcMode="linear" keyTimes="{keys}" values="{vals}"/>'
                "</rect></clipPath>")

    def cursor(keys, vals, colour, y1, y2):
        moves = ";".join(v + " 0" for v in vals.split(";"))
        return (f'<line x1="{cx0}" x2="{cx0}" y1="{y1}" y2="{y2}" stroke="{colour}" stroke-width="1" opacity="0.7">'
                f'<animateTransform attributeName="transform" type="translate" dur="{dur:.3f}s" repeatCount="indefinite" calcMode="linear" '
                f'keyTimes="{keys}" values="{moves}"/></line>')

    # The gap: how far behind LEC is at each point of the lap.
    ad = [p["distance"] / A["telemetry"][-1]["distance"] for p in A["telemetry"]]
    at = [p["time"] for p in A["telemetry"]]
    gaps = []
    for p in thin(B["telemetry"], 20):
        f = p["distance"] / B["telemetry"][-1]["distance"]
        gaps.append((f, p["time"] - interp(ad, at, f)))
    gy0, gh = 440, 110
    gmax = max(0.8, max(abs(g) for _, g in gaps))
    gpath = "M" + " L".join(f"{cx0 + f * cw:.1f},{gy0 + gh / 2 - g / gmax * gh / 2:.1f}" for f, g in gaps)

    grid = ""
    for v in range(0, vmax + 1, 50):
        y = cy0 + ch - v / vmax * ch
        grid += f'<line x1="{cx0}" x2="{cx0 + cw}" y1="{y:.1f}" y2="{y:.1f}" stroke="{GANTRY}" stroke-width="{1 if v else 1.5}" opacity="{0.55 if v else 1}"/>'
        grid += f'<text x="{cx0 - 8}" y="{y + 4:.1f}" text-anchor="end" font-size="11" fill="{FAINT}">{v}</text>'
    for km in range(0, 8):
        x = cx0 + km * 1000 / A["telemetry"][-1]["distance"] * cw
        if x <= cx0 + cw:
            grid += f'<text x="{x:.1f}" y="{cy0 + ch + 18}" text-anchor="middle" font-size="11" fill="{FAINT}">{km} km</text>'

    def chip(x, code, colour, lap):
        m, s = divmod(lap, 60)
        return (f'<rect x="{x}" y="34" width="210" height="44" fill="{KERB}" stroke="{GANTRY}"/><rect x="{x}" y="34" width="6" height="44" fill="{colour}"/>'
                f'<text x="{x + 20}" y="63" font-size="22" font-weight="900" font-style="italic" fill="{CHALK}">{code}</text>'
                f'<text x="{x + 196}" y="63" text-anchor="end" font-size="20" font-weight="700" fill="{MUTE}">{int(m)}:{s:06.3f}</text>')

    delta = B["lap_time"] - A["lap_time"]
    finish_a = A["lap_time"] / cycle_lap * 100
    finish_b = B["lap_time"] / cycle_lap * 100
    style = (
        "<style>"
        f"text{{font-family:{FONT}}}"
        f"@keyframes fa{{0%,{finish_a - 0.01:.2f}%{{opacity:0}}{finish_a:.2f}%,98%{{opacity:1}}100%{{opacity:0}}}}"
        f".fa{{opacity:0;animation:fa {dur:.3f}s linear infinite}}"
        f"@keyframes fb{{0%,{finish_b - 0.01:.2f}%{{opacity:0}}{finish_b:.2f}%,98%{{opacity:1}}100%{{opacity:0}}}}"
        f".fb{{opacity:0;animation:fb {dur:.3f}s linear infinite}}"
        + REDUCED + "</style>"
    )
    body = (
        style + f"<defs>{DEFS_COMMON}{GLOW}</defs>" + backdrop(W, H)
        + f'<rect x="0" y="0" width="{W}" height="4" fill="{RED}"/>'
        + f'<text x="40" y="52" font-size="13" font-weight="700" letter-spacing="3" fill="{FAINT}">HEAD TO HEAD</text>'
        + f'<text x="40" y="80" font-size="26" font-weight="900" font-style="italic" fill="{CHALK}">Belgium 2024, qualifying</text>'
        + chip(700, A["code"], A["color"], A["lap_time"]) + chip(925, B["code"], B["color"], B["lap_time"])
        + f'<path d="{d}" fill="none" stroke="#0B0B10" stroke-width="18" stroke-linejoin="round"/>'
        + f'<path id="lap" d="{d}" fill="none" stroke="{GANTRY}" stroke-width="10" stroke-linejoin="round"/>'
        + f'<path d="{d}" fill="none" stroke="{EDGE}" stroke-width="1" stroke-dasharray="2 6" opacity="0.6"/>'
        + corners
        + f'<g filter="url(#glow)"><circle r="8" fill="{B["color"]}" stroke="{BG}" stroke-width="2.5">'
          f'<animateMotion dur="{dur:.3f}s" repeatCount="indefinite" calcMode="linear" keyTimes="{ktb}" keyPoints="{kpb}"><mpath href="#lap"/></animateMotion></circle>'
          f'<circle r="8" fill="{A["color"]}" stroke="{BG}" stroke-width="2.5">'
          f'<animateMotion dur="{dur:.3f}s" repeatCount="indefinite" calcMode="linear" keyTimes="{kta}" keyPoints="{kpa}"><mpath href="#lap"/></animateMotion></circle></g>'
        + f'<text x="40" y="560" font-size="12" font-weight="700" letter-spacing="2" fill="{FAINT}">REAL TELEMETRY FROM FASTF1, REPLAYED AT {slow:g}x</text>'
        + f'<text x="{cx0}" y="{cy0 - 14}" font-size="12" font-weight="700" letter-spacing="2.5" fill="{FAINT}">SPEED  KM/H</text>'
        + grid
        + f'<defs>{clip("ca", dka, dva)}{clip("cb", dkb, dvb)}</defs>'
        + f'<path d="{trace(B["telemetry"])}" fill="none" stroke="{B["color"]}" stroke-width="2" clip-path="url(#cb)"/>'
        + f'<path d="{trace(A["telemetry"])}" fill="none" stroke="{A["color"]}" stroke-width="2" clip-path="url(#ca)"/>'
        + cursor(dka, dva, CHALK, cy0, cy0 + ch)
        + f'<text x="{cx0}" y="{gy0 - 12}" font-size="12" font-weight="700" letter-spacing="2.5" fill="{FAINT}">GAP  ·  ABOVE THE LINE, {B["code"]} IS BEHIND</text>'
        + f'<line x1="{cx0}" x2="{cx0 + cw}" y1="{gy0 + gh / 2}" y2="{gy0 + gh / 2}" stroke="{GANTRY}" stroke-width="1.5"/>'
        + f'<path d="{gpath}" fill="none" stroke="{CHALK}" stroke-width="2" clip-path="url(#cb)"/>'
        + cursor(dkb, dvb, B["color"], gy0, gy0 + gh)
        + f'<g class="fa"><rect x="{cx0 + cw - 150}" y="{cy0 + 6}" width="150" height="30" fill="{A["color"]}"/>'
          f'<text x="{cx0 + cw - 75}" y="{cy0 + 27}" text-anchor="middle" font-size="15" font-weight="900" letter-spacing="1.5" fill="{CHALK}">{A["code"]} FINISHES</text></g>'
        + f'<g class="fb"><rect x="{cx0 + cw - 150}" y="{cy0 + 40}" width="150" height="30" fill="{KERB}" stroke="{B["color"]}"/>'
          f'<text x="{cx0 + cw - 75}" y="{cy0 + 61}" text-anchor="middle" font-size="15" font-weight="900" fill="{CHALK}">{B["code"]} +{delta:.3f}</text></g>'
    )
    return svg(W, H, body, "Two qualifying laps, replayed",
               f"{A['code']} and {B['code']}'s best qualifying laps at Spa in 2024 drawn together: cars on the circuit, speed traces and the gap.")


# --- The live page ----------------------------------------------------------------------------------

def tower():
    W, H = 1200, 540
    period = 10.0
    grid = [("VER", "#3671C6", ["LEADER"] * 3, "M", 18),
            ("PIA", "#FF8000", ["+1.204", "+1.180", "+1.151"], "M", 17),
            ("LEC", "#E80020", ["+3.881", "+4.120", "+4.402"], "H", 25),
            ("NOR", "#FF8000", ["+4.336", "+3.790", "+3.540"], "M", 9),
            ("HAM", "#E80020", ["+9.115", "+9.062", "+9.241"], "H", 24),
            ("RUS", "#27F4D2", ["+11.40", "+11.92", "+12.38"], "H", 26),
            ("ANT", "#27F4D2", ["+12.07", "+12.44", "+12.61"], "M", 15),
            ("ALB", "#64C4FF", ["+18.90", "+19.26", "+19.71"], "H", 27),
            ("GAS", "#FF87BC", ["+21.33", "+21.80", "+22.04"], "M", 14),
            ("HAD", "#3671C6", ["+24.65", "+24.99", "+25.47"], "S", 6)]
    TYRE = {"S": "#E10600", "M": "#F6C945", "H": "#F0F0F5"}
    x0, y0, rh, tw = 40, 96, 38, 470
    css = [f"text{{font-family:{FONT}}}"]
    rows = ""
    for i, (code, colour, gaps, tyre, age) in enumerate(grid):
        y = y0 + i * rh
        cls = ""
        if code == "NOR":
            cls = "up"
        elif code == "LEC":
            cls = "down"
        band = KERB if i % 2 == 0 else "#1A1A25"
        gap_txt = ""
        for k, g in enumerate(gaps):
            gap_txt += (f'<text class="g{k}" x="{x0 + 330}" y="{y + 25}" text-anchor="end" font-size="17" font-weight="600" '
                        f'fill="{CHALK if k == 0 else MUTE}">{g}</text>')
        rows += (f'<g class="{cls}"><rect x="{x0 + 44}" y="{y}" width="{tw - 44}" height="{rh - 2}" fill="{band}"/>'
                 f'<rect x="{x0 + 44}" y="{y}" width="5" height="{rh - 2}" fill="{colour}"/>'
                 f'<text x="{x0 + 62}" y="{y + 25}" font-size="19" font-weight="900" font-style="italic" fill="{CHALK}">{code}</text>'
                 + gap_txt +
                 f'<circle cx="{x0 + 372}" cy="{y + 18}" r="10" fill="none" stroke="{TYRE[tyre]}" stroke-width="3"/>'
                 f'<text x="{x0 + 372}" y="{y + 22.5}" text-anchor="middle" font-size="11" font-weight="900" fill="{CHALK}">{tyre}</text>'
                 f'<text x="{x0 + 392}" y="{y + 23}" font-size="12" fill="{FAINT}">{age}L</text>'
                 + (f'<g class="drs"><rect x="{x0 + 418}" y="{y + 8}" width="42" height="20" fill="none" stroke="{GREEN}"/>'
                    f'<text x="{x0 + 439}" y="{y + 23}" text-anchor="middle" font-size="12" font-weight="900" fill="{GREEN}">DRS</text></g>' if code == "NOR" else "")
                 + (f'<rect class="purple" x="{x0 + 418}" y="{y + 8}" width="42" height="20" fill="{PURPLE}"/>'
                    f'<text class="purple" x="{x0 + 439}" y="{y + 23}" text-anchor="middle" font-size="12" font-weight="900" fill="{BG}">S2</text>' if code == "ANT" else "")
                 + "</g>")
    pos = "".join(f'<rect x="{x0}" y="{y0 + i * rh}" width="40" height="{rh - 2}" fill="{RAISED}"/>'
                  f'<text x="{x0 + 20}" y="{y0 + i * rh + 25}" text-anchor="middle" font-size="17" font-weight="900" fill="{CHALK}">{i + 1}</text>'
                  for i in range(len(grid)))
    # Gap values tick over every third of the loop.
    for k in range(3):
        a, b = k * 100 / 3, (k + 1) * 100 / 3
        css.append(f"@keyframes g{k}{{0%,{max(a - 0.01, 0):.2f}%{{opacity:0}}{a:.2f}%,{b - 0.01:.2f}%{{opacity:1}}{b:.2f}%,100%{{opacity:0}}}}"
                   f".g{k}{{opacity:0;animation:g{k} {period}s steps(1) infinite}}")
    css.append(f".g0{{animation-name:g0first}}@keyframes g0first{{0%,33.32%{{opacity:1}}33.33%,100%{{opacity:0}}}}")
    # NOR gets DRS, then goes past LEC.
    css += [
        f"@keyframes up{{0%,26%{{transform:none}}33%,92%{{transform:translateY(-{rh}px)}}100%{{transform:none}}}}.up{{animation:up {period}s cubic-bezier(.6,0,.2,1) infinite}}",
        f"@keyframes down{{0%,26%{{transform:none}}33%,92%{{transform:translateY({rh}px)}}100%{{transform:none}}}}.down{{animation:down {period}s cubic-bezier(.6,0,.2,1) infinite}}",
        f"@keyframes drs{{0%,3%{{opacity:0}}5%,30%{{opacity:1}}9%,15%,21%,27%{{opacity:.35}}12%,18%,24%{{opacity:1}}33%,100%{{opacity:0}}}}.drs{{animation:drs {period}s infinite}}",
        f"@keyframes purple{{0%,62%{{opacity:0}}64%,90%{{opacity:1}}94%,100%{{opacity:0}}}}.purple{{animation:purple {period}s infinite}}",
        ".live{animation:pulse 1.2s ease-in-out infinite}@keyframes pulse{50%{opacity:.2}}",
        f"@keyframes close{{0%{{transform:scaleX(.5)}}28%,100%{{transform:scaleX(.1)}}}}.close{{transform-box:fill-box;transform-origin:left;animation:close {period}s ease-in-out infinite}}",
        f"@keyframes close2{{0%{{transform:scaleX(1)}}100%{{transform:scaleX(.6)}}}}.close2{{transform-box:fill-box;transform-origin:left;animation:close2 {period}s linear infinite}}",
        ".in{opacity:0;animation:in .6s ease-out forwards}@keyframes in{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:none}}",
        f"@keyframes lapn{{0%,49.99%{{opacity:1}}50%,100%{{opacity:0}}}}.lap1{{animation:lapn {period}s steps(1) infinite}}"
        f"@keyframes lapm{{0%,49.99%{{opacity:0}}50%,100%{{opacity:1}}}}.lap2{{opacity:0;animation:lapm {period}s steps(1) infinite}}",
        REDUCED,
    ]

    px = 560
    def card(y, delay, inner, h=74):
        return (f'<g class="in" style="animation-delay:{delay}s"><rect x="{px}" y="{y}" width="600" height="{h}" fill="{KERB}" stroke="{GANTRY}"/>'
                f'{inner}</g>')
    label = lambda x, y, t: f'<text x="{x}" y="{y}" font-size="11" font-weight="700" letter-spacing="2.5" fill="{FAINT}">{t}</text>'
    panel = (
        f'<text x="{px}" y="84" font-size="13" font-weight="700" letter-spacing="3" fill="{FAINT}">BATTLES AND PIT STOPS</text>'
        + card(96, 0.3,
               label(px + 18, 118, "BATTLE")
               + f'<text x="{px + 18}" y="152" font-size="22" font-weight="900" font-style="italic" fill="{CHALK}">NOR on LEC</text>'
               + f'<rect x="{px + 200}" y="136" width="220" height="10" fill="{RAISED}"/><rect class="close" x="{px + 200}" y="136" width="220" height="10" fill="#FF8000"/>'
               + f'<rect x="{px + 440}" y="128" width="142" height="26" fill="none" stroke="{RED}"/>'
               f'<text x="{px + 511}" y="146" text-anchor="middle" font-size="13" font-weight="900" letter-spacing="1.2" fill="#FF6B60">IN DRS NOW</text>')
        + card(180, 0.5,
               label(px + 18, 202, "BATTLE")
               + f'<text x="{px + 18}" y="236" font-size="22" font-weight="900" font-style="italic" fill="{CHALK}">ANT on RUS</text>'
               + f'<rect x="{px + 200}" y="220" width="220" height="10" fill="{RAISED}"/><rect class="close2" x="{px + 200}" y="220" width="220" height="10" fill="#27F4D2"/>'
               + f'<rect x="{px + 440}" y="212" width="142" height="26" fill="none" stroke="{YELLOW}"/>'
               f'<text x="{px + 511}" y="230" text-anchor="middle" font-size="13" font-weight="900" letter-spacing="1.2" fill="{YELLOW}">DRS IN ~3 LAPS</text>')
        + card(264, 0.7,
               label(px + 18, 286, "IF THEY PIT NOW")
               + f'<text x="{px + 18}" y="320" font-size="22" font-weight="900" font-style="italic" fill="{CHALK}">VER</text>'
               + f'<text x="{px + 76}" y="320" font-size="19" fill="{CHALK}">→ P3, 1.0 s behind LEC</text>'
               + f'<rect x="{px + 440}" y="304" width="142" height="26" fill="none" stroke="{YELLOW}"/>'
               f'<text x="{px + 511}" y="322" text-anchor="middle" font-size="13" font-weight="900" letter-spacing="1.2" fill="{YELLOW}">TRAFFIC</text>')
        + card(348, 0.9,
               label(px + 18, 370, "UNDERCUT")
               + f'<text x="{px + 18}" y="404" font-size="22" font-weight="900" font-style="italic" fill="{CHALK}">HAM on NOR</text>'
               + f'<text x="{px + 200}" y="404" font-size="19" fill="{MUTE}">onto hards, by 0.8 s</text>'
               + f'<rect x="{px + 440}" y="388" width="142" height="26" fill="none" stroke="{GREEN}"/>'
               f'<text x="{px + 511}" y="406" text-anchor="middle" font-size="13" font-weight="900" letter-spacing="1.2" fill="{GREEN}">LIKELY</text>')
    )
    body = (
        "<style>" + "".join(css) + "</style>" + f"<defs>{DEFS_COMMON}</defs>" + backdrop(W, H)
        + f'<rect x="0" y="0" width="{W}" height="4" fill="{RED}"/>'
        + f'<rect x="{x0}" y="40" width="74" height="28" fill="{RED}"/><circle class="live" cx="{x0 + 16}" cy="54" r="5" fill="{CHALK}"/>'
          f'<text x="{x0 + 28}" y="60" font-size="15" font-weight="900" letter-spacing="2" fill="{CHALK}">LIVE</text>'
        + f'<text class="lap1" x="{x0 + 90}" y="61" font-size="18" font-weight="700" fill="{MUTE}">LAP 31 / 44</text>'
          f'<text class="lap2" x="{x0 + 90}" y="61" font-size="18" font-weight="700" fill="{MUTE}">LAP 32 / 44</text>'
        + pos + f'<g clip-path="url(#towerclip)">{rows}</g>'
        + f'<clipPath id="towerclip"><rect x="{x0}" y="{y0}" width="{tw}" height="{rh * len(grid)}"/></clipPath>'
        + panel
        + f'<text x="{x0}" y="{H - 22}" font-size="12" font-weight="700" letter-spacing="2" fill="{FAINT}">ILLUSTRATION OF THE LIVE PAGE  ·  THE REAL ONE FILLS IN FROM F1\'S TIMING FEED DURING A SESSION</text>'
    )
    return svg(W, H, body, "Live timing", "A live timing tower where one car takes DRS and passes another, beside the battles and pit stop forecasts.")


# --- Divider ----------------------------------------------------------------------------------------

def kerb():
    W, H = 1200, 14
    body = (
        f'<defs><pattern id="k" width="56" height="{H}" patternUnits="userSpaceOnUse">'
        f'<rect width="56" height="{H}" fill="{CHALK}"/><path d="M0 0 h28 l-8 {H} h-28 z M56 0 h28 l-8 {H} h-28 z" fill="{RED}"/>'
        f'<animateTransform attributeName="patternTransform" type="translate" from="0 0" to="-56 0" dur="0.9s" repeatCount="indefinite"/>'
        f"</pattern>"
        f'<linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".15" stop-color="#fff"/>'
        f'<stop offset=".85" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'
        f'<mask id="m"><rect width="{W}" height="{H}" fill="url(#fade)"/></mask></defs>'
        f'<rect width="{W}" height="{H}" fill="url(#k)" mask="url(#m)"/>'
    )
    return svg(W, H, body, "", "")


for name, make in (("hero.svg", hero), ("head-to-head.svg", duel_svg), ("live.svg", tower), ("kerb.svg", kerb)):
    text = make()
    open(os.path.join(OUT, name), "w", encoding="utf-8").write(text)
    print(name, f"{len(text) / 1024:.0f} KB")
