"""
Download newly finished sessions on this machine and copy them into a deployed server's race cache.

Formula 1's timing archive needs an F1 TV sign-in and refuses cloud-server IPs, so a deployed backend
can't download races itself. Run this on a machine that can, and schedule it to run hourly. When the
F1 TV sign-in (good for 4 days) has expired and sessions are waiting, it opens the sign-in page and
carries on once you've signed in.

Usage (from backend/):
    PITWALL_SSH=ubuntu@<server-ip> PITWALL_SSH_KEY=~/.ssh/<key> python -m app.scripts.sync_sessions
    ... python -m app.scripts.sync_sessions --since 2018   # backfill earlier seasons
    ... python -m app.scripts.sync_sessions --analyses 2   # after a deploy: re-send the last 2 sessions' telemetry pages

Each new session's telemetry pages (pedals, and corners for every driver) are worked out here, where
it takes seconds, and uploaded with it: on the 1 GB server each takes a minute and stalls the site.

Safe to interrupt and rerun: copied sessions are listed in <cache dir>/synced.txt and skipped.
"""
import argparse
import functools
import gc
import io
import logging
import os
import re
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import webbrowser
from pathlib import Path
from typing import List, Optional
from unittest.mock import patch

import fastf1
import pandas as pd
from fastf1.internals.f1account import token_manager
from fastf1.req import RateLimitExceededError

from app.core.config import settings
from app.services import fastf1_fixes  # noqa: F401  (patches FastF1 on import)
from app.services import saved_analyses

# Sprint qualifying was "Sprint Shootout" in 2023 and is "Sprint Qualifying" from 2024 (2021-22 sprints had none).
WANTED = {"Qualifying", "Sprint Shootout", "Sprint Qualifying", "Sprint", "Race"}
SKIP = {"2018 14 Italian Grand Prix | Race"}  # FastF1 crashes processing its tyre stints (IndexError)
SETTLE = pd.Timedelta(hours=4)  # F1 publishes a session's files a while after it ends
SIGN_IN_WAIT_S = 30 * 60  # how long an opened sign-in page waits for you
SIGN_IN_EVERY = pd.Timedelta(hours=6)  # so an ignored sign-in isn't a new browser tab every hour
# where docker-compose.prod.yml's fastf1_cache volume lives on the server
VOLUME = os.environ.get("PITWALL_CACHE_VOLUME", "/var/lib/docker/volumes/pitwall_fastf1_cache/_data")
REPO = os.environ.get("PITWALL_REPO", "~/Pitwall")
# The pages ask by these codes, and a saved analysis is only found by exactly what was asked for.
SESSION_CODES = {"Qualifying": "Q", "Sprint Shootout": "SS", "Sprint Qualifying": "SQ", "Sprint": "S", "Race": "R"}
# Worked out here rather than on the 1 GB server, where each needs a whole session's telemetry: a
# minute or more apiece there, stalling every other request, against seconds on this machine.
TELEMETRY_ANALYSES = ("pedal_behavior_payload", "corner_consistency_payload")


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


def parse_key(key: str):
    """(year, round, session name) back out of a due_sessions key."""
    head, name = key.split(" | ")
    return int(head[:4]), int(head[5:7]), name


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


def save_telemetry_analyses(year: int, rnd: int, name: str) -> None:
    """Work out a session's TELEMETRY_ANALYSES (pedals, and corners for every driver) into
    SAVED_ANALYSES_DIR, for refresh_saved to upload."""
    from app.services import corner_analysis, duel_telemetry, session_info
    from app.services.session_info import SessionDataError

    code = SESSION_CODES[name]
    drivers = [d["code"] for d in session_info.session_info(year, "", code, rnd)["drivers"]]
    load = functools.lru_cache(maxsize=1)(session_info.load_session)  # one telemetry load for them all
    jobs = [("pedals", lambda: duel_telemetry.pedal_behavior_payload(year, "", code, rnd))]
    jobs += [(d, lambda d=d: corner_analysis.corner_consistency_payload(year, "", code, d, rnd)) for d in drivers]
    with patch.object(duel_telemetry, "load_session", load), patch.object(corner_analysis, "load_session", load):
        for what, job in jobs:
            try:
                job()
            except SessionDataError:
                pass  # e.g. too few clean laps: the page says so, and there's nothing to save
            except Exception as e:
                log(f"couldn't work out {what} for {year} {rnd} {code}: {e!r}"[:200])
    load.cache_clear()


def server_code_version(server: str, key_file: str) -> Optional[str]:
    result = subprocess.run(["ssh", "-i", key_file, "-o", "BatchMode=yes", server,
                             f"cd {REPO} && docker compose -f docker-compose.prod.yml exec -T backend python -c "
                             f"'from app.services.saved_analyses import VERSION; print(VERSION)'"],
                            capture_output=True, text=True)
    lines = result.stdout.split()
    return lines[-1] if result.returncode == 0 and lines else None


def staged_for_upload(staging: Path, server_version: Optional[str]) -> List[Path]:
    """The staged telemetry analyses the server's code would find: saved under its exact code version."""
    if not server_version:
        return []
    return sorted(p for p in (staging / server_version).rglob("*.pkl") if p.name.startswith(TELEMETRY_ANALYSES))


def refresh_saved(years, server: str, key_file: str, staging: Path):
    """Drop what the server saved for these seasons, add the analyses worked out here, then work the rest
    out on the server in the background. A request that came in mid-upload could have saved an
    analysis of half a session."""
    server_version = server_code_version(server, key_file)
    files = staged_for_upload(staging, server_version)
    if server_version != saved_analyses.VERSION:
        log(f"the server runs other code ({server_version} here {saved_analyses.VERSION}): "
            "its telemetry pages will be worked out there on first visit")
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w") as tar:
        for f in files:
            tar.add(f, arcname=f.relative_to(staging).as_posix())
    clear = " ".join(f"{VOLUME}/_saved/*/{y}" for y in years)
    warm = " ".join(str(y) for y in years)
    result = subprocess.run(["ssh", "-i", key_file, "-o", "BatchMode=yes", server,
                             f"sudo rm -rf {clear}; sudo mkdir -p {VOLUME}/_saved && "
                             f"sudo tar -xf - --no-same-owner -C {VOLUME}/_saved; "
                             f"cd {REPO} && docker compose -f docker-compose.prod.yml "
                             f"exec -d -T backend nice -n 19 python -m app.scripts.warm_saved {warm}"],
                            input=archive.getvalue())
    if result.returncode:
        log(f"couldn't refresh the saved analyses (ssh exit {result.returncode})")
        return
    log(f"uploaded {len(files)} telemetry analyses")
    shutil.rmtree(staging, ignore_errors=True)


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


def sign_in_in_browser(cache: Path, waiting: int) -> bool:
    """Opens the F1 TV sign-in page and waits for it. True once a fresh token is stored."""
    prompted = cache / "sign_in_opened.txt"
    if prompted.exists() and pd.Timestamp.now() - pd.Timestamp(prompted.read_text()) < SIGN_IN_EVERY:
        log(f"F1 TV sign-in expired, {waiting} new session(s) waiting; the sign-in page was opened recently")
        return False
    prompted.write_text(pd.Timestamp.now().isoformat())
    log(f"F1 TV sign-in expired, {waiting} new session(s) waiting: opening the sign-in page")

    from fastf1.internals.f1account import browser
    # FastF1 only prints the page's address, and nobody sees a scheduled run's output, so open it instead
    browser.print = lambda message: webbrowser.open(re.search(r"https://\S+", message).group(0))
    signing_in = threading.Thread(target=token_manager.get, daemon=True,
                                  kwargs={"force_renew": True, "auth_func": browser.login_browser})
    signing_in.start()
    signing_in.join(SIGN_IN_WAIT_S)
    token = token_manager.get_stored()
    return bool(token and token.is_valid())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--since", type=int, default=pd.Timestamp.now().year, help="first season to check")
    parser.add_argument("--analyses", type=int, metavar="N",
                        help="only work out and upload the telemetry analyses of the N most recently synced "
                             "sessions (a deploy that changes the analysis code starts the server's afresh)")
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
    staging = cache / "_saved_upload"  # analyses worked out here wait here for refresh_saved
    settings.SAVED_ANALYSES_DIR = str(staging)

    if args.analyses:
        recent = [parse_key(k) for k in synced.read_text().splitlines()[-args.analyses:]] if synced.exists() else []
        for year, rnd, name in recent:
            log(f"working out the telemetry analyses for {year} {rnd} {name}")
            save_telemetry_analyses(year, rnd, name)
            gc.collect()
        if recent:
            refresh_saved(sorted({year for year, _, _ in recent}), server, key_file, staging)
        return 0

    now = pd.Timestamp.now(tz="UTC").tz_localize(None)
    due = [(year, *session) for year in range(args.since, now.year + 1)
           for session in due_sessions(year, fastf1.get_event_schedule(year, include_testing=False), now, done)]
    if not due:
        log("nothing new")
        return 0

    token = token_manager.get_stored()
    if not (token and token.is_valid()) and not os.environ.get("F1_USERNAME"):
        # without this check FastF1 would sit at a password prompt nobody sees
        if not sign_in_in_browser(cache, len(due)):
            log("not signed in; trying again on the next run")
            return 2
        log("signed in")

    added = failed = 0
    uploaded = set()
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
        uploaded.add(year)
        log("added", key)
        try:
            save_telemetry_analyses(year, rnd, name)
        except Exception as e:  # the server works them out on first visit instead
            log(f"couldn't work out the telemetry analyses for {key}: {e!r}"[:200])
        finally:
            gc.collect()
    log(f"done: {added} added, {failed} failed")
    if uploaded:
        refresh_saved(sorted(uploaded), server, key_file, staging)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
