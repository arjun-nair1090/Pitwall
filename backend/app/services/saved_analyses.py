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


def saved(name: str, year: int, args: Any, compute: Callable[[], Any]) -> Any:
    """The saved result of `name` for (year, args), or compute() saved for next time. Errors aren't saved."""
    root = _root()
    if root is None:
        return compute()
    # Pickle, so a result comes back exactly as computed (JSON would turn int keys and tuples into
    # strings and lists). Only this backend writes these files, inside the volume that already holds
    # FastF1's own pickled cache; nothing a visitor sends ever reaches them.
    key = hashlib.sha256(repr(args).encode()).hexdigest()[:24]
    path = root / VERSION / str(int(year)) / f"{name}-{key}.pkl"
    try:
        with path.open("rb") as f:
            return pickle.load(f)
    except FileNotFoundError:
        pass
    except Exception as e:  # a torn or unreadable file is worked out again and overwritten
        print(f"Saved {name} unreadable, recomputing: {e!r}")
    value = compute()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        with os.fdopen(fd, "wb") as f:
            pickle.dump(value, f, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(tmp, path)  # atomic, so a reader never sees half a file
    except OSError as e:
        print(f"Couldn't save {name}: {e!r}")
    return value


def saved_analysis(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Decorates an analysis of one finished session whose first argument is the year."""
    @functools.wraps(fn)
    def wrapper(year: int, *args: Any, **kwargs: Any) -> Any:
        return saved(fn.__name__, year, (args, sorted(kwargs.items())), lambda: fn(year, *args, **kwargs))
    return wrapper


def prune_old_versions() -> None:
    """Delete what earlier code versions saved."""
    root = _root()
    if root is None or not root.is_dir():
        return
    for entry in root.iterdir():
        if entry.is_dir() and entry.name != VERSION:
            shutil.rmtree(entry, ignore_errors=True)
