"""
Download newly finished sessions on this machine and copy them into a deployed server's race cache.

Formula 1's timing archive needs an F1 TV sign-in and refuses cloud-server IPs, so a deployed backend
can't download races itself. Run this on a machine that can, after signing in once with
`python -m fastf1 auth f1tv --authenticate --method browser`, and schedule it to run daily.

Usage (from backend/):
    PITWALL_SSH=ubuntu@<server-ip> PITWALL_SSH_KEY=~/.ssh/<key> python -m app.scripts.sync_sessions
    ... python -m app.scripts.sync_sessions --since 2018   # backfill earlier seasons

Safe to interrupt and rerun: copied sessions are listed in <cache dir>/synced.txt and skipped.
"""
import argparse
import gc
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

import fastf1
import pandas as pd
from fastf1.internals.f1account.tokens import TokenStore
from fastf1.req import RateLimitExceededError

from app.core.config import settings

# Sprint qualifying was "Sprint Shootout" in 2023 and is "Sprint Qualifying" from 2024 (2021-22 sprints had none).
WANTED = {"Qualifying", "Sprint Shootout", "Sprint Qualifying", "Sprint", "Race"}
SKIP = {"2018 14 Italian Grand Prix | Race"}  # FastF1 crashes processing its tyre stints (IndexError)
SETTLE = pd.Timedelta(hours=4)  # F1 publishes a session's files a while after it ends
# where docker-compose.prod.yml's fastf1_cache volume lives on the server
VOLUME = os.environ.get("PITWALL_CACHE_VOLUME", "/var/lib/docker/volumes/pitwall_fastf1_cache/_data")


def log(*a):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


def due_sessions(year: int, schedule: pd.DataFrame, now: pd.Timestamp, done: set):
    """Yield (round, session name, key) for each wanted session that ended a while ago and isn't synced yet."""
    for _, ev in schedule.iterrows():
        for i in range(1, 6):
            name, start = ev[f"Session{i}"], ev[f"Session{i}DateUtc"]
            key = f"{year} {ev['RoundNumber']:02d} {ev['EventName']} | {name}"
            if name in WANTED and key not in done and key not in SKIP and pd.notna(start) and start + SETTLE < now:
                yield int(ev["RoundNumber"]), name, key


def copy_to_server(cache: Path, session_dir: Path, server: str, key_file: str):
    rel = session_dir.relative_to(cache).as_posix()
    for _ in range(5):  # sshd randomly drops new connections while bots hammer port 22
        tar = subprocess.Popen(["tar", "-cf", "-", rel], cwd=cache, stdout=subprocess.PIPE)
        ssh = subprocess.run(["ssh", "-i", key_file, "-o", "BatchMode=yes", server,
                              # refuse (exit 99) once under 3 GB is free, so the backend never runs out of disk
                              f"[ $(df --output=avail / | tail -1) -gt 3000000 ] || exit 99; "
                              f"sudo tar -xf - --no-same-owner -C {VOLUME}"], stdin=tar.stdout)
        tar.stdout.close()
        if ssh.returncode == 99:
            sys.exit("Server disk is nearly full, stopping.")
        if not tar.wait() and not ssh.returncode:
            return
        time.sleep(15)
    raise RuntimeError(f"copy to server failed for {rel}")


def fetch(cache: Path, year: int, rnd: int, name: str, server: str, key_file: str):
    while True:
        try:
            s = fastf1.get_session(year, rnd, name)
            s.load(laps=True, telemetry=True, weather=True, messages=True)
            if s.laps.empty:
                raise RuntimeError("no laps (not published yet?)")
            # api_path is "/static/<year>/<event>/<session>/", mirrored under the cache dir
            copy_to_server(cache, cache / s.api_path.removeprefix("/static/").strip("/"), server, key_file)
            return
        except RateLimitExceededError:
            # FastF1 allows 500 calls an hour and counts refused calls too, so let the whole hour age out
            log("FastF1's hourly request limit reached, waiting 61 min")
            time.sleep(61 * 60)


def remind_to_sign_in(waiting: int):
    sign_in = f"{sys.executable} -m fastf1 auth f1tv --authenticate --method browser"
    log(f"F1 TV sign-in expired, {waiting} new session(s) waiting. Run: {sign_in}")
    if sys.platform == "win32":  # a scheduled run is hidden, so pop the reminder up where it'll be seen
        import ctypes
        subprocess.run("clip", input=sign_in, text=True)
        ctypes.windll.user32.MessageBoxW(
            None,
            f"{waiting} new F1 session(s) are ready for Pitwall, but your F1 TV sign-in has expired.\n\n"
            f"The sign-in command is copied. Paste it into a terminal, sign in, and they'll be added "
            f"on the next daily run:\n\n{sign_in}",
            "Pitwall race sync",
            0x40 | 0x1000,  # MB_ICONINFORMATION | MB_SYSTEMMODAL: an info box that stays on top
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--since", type=int, default=pd.Timestamp.now().year, help="first season to check")
    args = parser.parse_args()
    server = os.environ.get("PITWALL_SSH")
    if not server:
        sys.exit("Set PITWALL_SSH to the server's ssh login, e.g. ubuntu@203.0.113.7")
    key_file = os.path.expanduser(os.environ.get("PITWALL_SSH_KEY", "~/.ssh/id_ed25519"))

    cache = Path(settings.FASTF1_CACHE_DIR).resolve()
    fastf1.Cache.enable_cache(str(cache))
    fastf1.set_log_level(logging.ERROR)
    synced = cache / "synced.txt"
    done = set(synced.read_text().splitlines()) if synced.exists() else set()

    now = pd.Timestamp.now(tz="UTC").tz_localize(None)
    due = [(year, *session) for year in range(args.since, now.year + 1)
           for session in due_sessions(year, fastf1.get_event_schedule(year, include_testing=False), now, done)]
    if not due:
        log("nothing new")
        return 0

    token = TokenStore.default().load()
    if not (token and token.is_valid()) and not os.environ.get("F1_USERNAME"):
        # without this check FastF1 would sit at a password prompt nobody sees
        remind_to_sign_in(len(due))
        return 2

    added = failed = 0
    for year, rnd, name, key in due:
        try:
            fetch(cache, year, rnd, name, server, key_file)
        except Exception as e:  # one bad session shouldn't stop the rest
            failed += 1
            log(f"FAILED {key}: {e}")
            continue
        finally:
            gc.collect()
        with synced.open("a") as f:
            f.write(key + "\n")
        added += 1
        log("added", key)
    log(f"done: {added} added, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
