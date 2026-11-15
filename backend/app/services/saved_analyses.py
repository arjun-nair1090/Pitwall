"""A finished race's analyses never change, so each is worked out once and kept on disk.

Off unless SAVED_ANALYSES_DIR is set, so tests and local runs always compute. Entries live under
<dir>/<code version>/<year>/. The version hashes the analysis code and FastF1's version, so a deploy
that changes how anything is worked out starts afresh and a saved answer is always what the code
would give now. The race sync clears a year after it uploads one of that year's sessions.
"""
import functools
import hashlib
import os
import pickle
import shutil
import tempfile
from pathlib import Path
from typing import Any, Callable, Optional

import fastf1

from app.core.config import settings


def _code_version() -> str:
    digest = hashlib.sha256(fastf1.__version__.encode())
    for source in sorted(Path(__file__).parent.glob("*.py")):
        digest.update(source.name.encode())
        digest.update(source.read_bytes())
    return digest.hexdigest()[:12]


VERSION = _code_version()


def _root() -> Optional[Path]:
    return Path(settings.SAVED_ANALYSES_DIR) if settings.SAVED_ANALYSES_DIR else None


_MISSING = object()


def _path(name: str, year: int, args: Any) -> Optional[Path]:
    root = _root()
    if root is None:
        return None
    # Pickle, so a result comes back exactly as computed (JSON would turn int keys and tuples into
    # strings and lists). Only this backend writes these files, inside the volume that already holds
    # FastF1's own pickled cache; nothing a visitor sends ever reaches them.
    key = hashlib.sha256(repr(args).encode()).hexdigest()[:24]
    return root / VERSION / str(int(year)) / f"{name}-{key}.pkl"


def peek(name: str, year: int, args: Any, default: Any = None) -> Any:
    """What was saved for `name` at (year, args), else `default`."""
    path = _path(name, year, args)
    if path is None:
        return default
    try:
        with path.open("rb") as f:
            return pickle.load(f)
    except FileNotFoundError:
        return default
    except Exception as e:  # a torn or unreadable file is worked out again and overwritten
        print(f"Saved {name} unreadable, recomputing: {e!r}")
        return default


def store(name: str, year: int, args: Any, value: Any) -> None:
    path = _path(name, year, args)
    if path is None:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        with os.fdopen(fd, "wb") as f:
            pickle.dump(value, f, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(tmp, path)  # atomic, so a reader never sees half a file
    except OSError as e:
        print(f"Couldn't save {name}: {e!r}")


def saved(name: str, year: int, args: Any, compute: Callable[[], Any]) -> Any:
    """The saved result of `name` for (year, args), or compute() saved for next time. Errors aren't saved."""
    if _root() is None:
        return compute()
    found = peek(name, year, args, _MISSING)
    if found is not _MISSING:
        return found
    value = compute()
    store(name, year, args, value)
    return value


def saved_analysis(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Decorates an analysis of one finished session called as fn(year, gp, session, round, ...).

    Only a race named by its round is saved. FastF1 matches nearly any text to some race, so saving
    by name would give every spelling a visitor tries its own file; the pages and the chatbot always
    send the round, and every other argument is checked before anything is saved."""
    @functools.wraps(fn)
    def wrapper(year: int, gp: str = "", *args: Any, **kwargs: Any) -> Any:
        if gp:
            return fn(year, gp, *args, **kwargs)
        return saved(fn.__name__, year, (args, sorted(kwargs.items())), lambda: fn(year, gp, *args, **kwargs))
    return wrapper


def prune_old_versions() -> None:
    """Delete what earlier code versions saved."""
    root = _root()
    if root is None or not root.is_dir():
        return
    for entry in root.iterdir():
        if entry.is_dir() and entry.name != VERSION:
            shutil.rmtree(entry, ignore_errors=True)
