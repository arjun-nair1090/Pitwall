"""Per-client request limits for the routes worth abusing: signing in, and the ones that spend AI credits."""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

# ponytail: in-process memory, so each worker counts separately and a restart forgets; move to Redis
# if the backend ever runs more than one worker.
_hits: dict[tuple[str, str], deque] = defaultdict(deque)


def rate_limit(name: str, limit: int, window_s: int):
    """A dependency allowing `limit` requests per client IP per `window_s` seconds across the routes named `name`.

    Behind a proxy, run uvicorn with --proxy-headers so request.client is the visitor, not the proxy."""
    def check(request: Request) -> None:
        now = time.monotonic()
        hits = _hits[(name, request.client.host if request.client else "unknown")]
        while hits and hits[0] <= now - window_s:
            hits.popleft()
        if len(hits) >= limit:
            retry = int(hits[0] + window_s - now) + 1
            raise HTTPException(
                status_code=429,
                detail=f"Too many requests. Try again in {max(1, round(retry / 60))} min.",
                headers={"Retry-After": str(retry)},
            )
        hits.append(now)
    return check


def reset() -> None:
    _hits.clear()
