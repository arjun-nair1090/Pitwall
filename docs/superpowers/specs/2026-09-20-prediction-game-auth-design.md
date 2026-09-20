# Prediction Game & Auth (Roadmap Phase 5, item 3)

Status: approved, not yet implemented
Date: 2026-09-20
Relates to: `PITWALL_FIX_AND_FEATURE_ROADMAP.md` Phase 5 ("Prediction game / leaderboard")

## Problem

The prediction game/leaderboard needs to know *whose* prediction is whose. This
codebase has zero identity infrastructure today: no `User` model, no login, no
session handling. `SECRET_KEY` exists in `config.py` but nothing signs anything
with it yet. This is a genuinely new, security-relevant subsystem — treated with
more process rigor than other phases in this session, per explicit user decision.

Two foundational choices were made with the user before this spec was written
(not re-litigated here):
1. **Real accounts** (email + password + JWT), not anonymous device IDs.
2. **httpOnly cookie** for JWT delivery, not `localStorage` + Authorization header.

## Goals

- Users can sign up, log in, log out with a real password-based account.
- Sessions are httpOnly-cookie JWTs — never readable by page JavaScript.
- State-changing requests are CSRF-protected (double-submit cookie pattern),
  since httpOnly cookies are sent automatically cross-site by the browser.
- Users can submit a top-3 prediction for a specific real upcoming race, see a
  leaderboard of real points across all users.
- A prediction can't be submitted (or edited) once that race's session has
  actually started — checked against FastF1's real event schedule, not trusted
  client-side timestamps.
- Scoring a completed race is driven entirely by the real official result
  (Ergast) — a user's own submitted data can never influence their own score
  beyond "did you guess right."

## Non-goals

- No admin-role system. The `/predictions/score` endpoint is intentionally
  callable by anyone — it only *recomputes* points from real official results,
  so there's nothing to gain by calling it maliciously (see "Scoring" below for
  why this is safe, not just convenient).
- No password reset / email verification flow. Out of scope for a v1 — a user
  who forgets their password has no self-service recovery yet.
- No OAuth/social login.
- No rate limiting on login/signup (a real gap for a production deployment,
  called out explicitly rather than silently ignored — flagged as a follow-up).
- **Accepted risk (post-implementation security review):** `POST /auth/signup`
  returns 409 for an already-registered email, which lets someone enumerate
  registered accounts. Closing this properly needs an email-verification flow
  (already a stated non-goal above) — a generic "check your email" response
  only works once accounts aren't immediately usable pre-verification. Flagged
  explicitly rather than fixed silently or ignored; revisit if/when email
  verification is built.

## Post-implementation security review

A dedicated review pass (this session's `security-review` skill) after Tasks
1-4 found no high-severity issues and four medium/low findings, three of which
were fixed before continuing to the prediction-game endpoints:
- Added a minimum/maximum password length check on signup (was previously unbounded).
- Added an Origin-header allow-list check on `/auth/login` and `/auth/signup`
  (the CSRF double-submit cookie can't cover these two routes — there's no
  CSRF cookie yet before a session exists — so a cross-site auto-submitting
  form could otherwise force a victim into an attacker-chosen account).
- Added JWT revocation: `create_access_token` now includes a `jti` claim,
  `logout` records it in Redis (best-effort — a `logout` still deletes the
  cookie even if Redis is unreachable, since Redis being down doesn't
  re-enable a bypass of the primary signature/expiry check), and
  `get_current_user` checks it. Token lifetime was also shortened from 7 days
  to 24 hours as defense-in-depth alongside revocation.
- The email-enumeration finding above was accepted as a documented tradeoff
  rather than fixed, since a real fix depends on the already-deferred email
  verification flow.

## Data model

Two new SQLAlchemy models in `app/models/models.py`:

```python
class UserModel(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    display_name = Column(String(50), nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class PredictionModel(Base):
    __tablename__ = "predictions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    year = Column(Integer, nullable=False)
    event_name = Column(String(200), nullable=False)
    predicted_p1 = Column(String(3), nullable=False)
    predicted_p2 = Column(String(3), nullable=False)
    predicted_p3 = Column(String(3), nullable=False)
    points_awarded = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "year", "event_name", name="uq_user_year_event"),
    )
```

`password_hash` is a bcrypt hash (includes its own salt) — never the plaintext,
never a reversible encoding.

## Password hashing — `auth_service.py`

```python
def hash_password(password: str) -> str: ...      # bcrypt.hashpw, utf-8, decode to str for storage
def verify_password(password: str, password_hash: str) -> bool: ...  # bcrypt.checkpw
```

Pure functions, no DB/network access — directly unit-testable (verify a hash
round-trips, verify a wrong password fails, verify two hashes of the same
password differ because of bcrypt's random salt).

## JWT — `auth_service.py`

```python
def create_access_token(user_id: int, expires_delta: timedelta = timedelta(days=7)) -> str: ...
def decode_access_token(token: str) -> Optional[int]:  # returns user_id, or None if invalid/expired/malformed
```

Signed with `settings.SECRET_KEY`, algorithm `HS256`, standard `exp`/`sub`
claims (`sub` = str(user_id)). `decode_access_token` never raises — any
`jwt.InvalidTokenError` subclass (expired, bad signature, malformed) is caught
and mapped to `None`. Note this is a different failure philosophy from the RAG
service's "degrade gracefully": here, the *caller* (the `get_current_user`
dependency) treats `None` as "not authenticated" and fails closed with a 401 —
auth must never silently continue as some other user or as anonymous-but-still-privileged.

## CSRF — double-submit cookie

On successful login/signup, the response sets **two** cookies:
- `session` — the JWT, `httponly=True`, `samesite="lax"`, `secure=<not RUNNING_LOCALLY>`.
- `csrf_token` — a `secrets.token_urlsafe(32)` value, **not** httpOnly (the
  frontend must be able to read it via `document.cookie`), same `samesite`/`secure`.

A FastAPI dependency `verify_csrf(request: Request)` used on every mutating
route (`POST`/`PUT`/`DELETE`) compares the `csrf_token` cookie against an
`X-CSRF-Token` request header; mismatch or either-missing is a 403. This works
because a malicious third-party site can trigger a cross-site request that
carries the victim's cookies automatically, but it **cannot read** the
victim's `csrf_token` cookie value (same-origin policy on `document.cookie`)
to construct a matching header — so it can't forge a request that passes both
checks at once.

## Auth endpoints — new `app/api/v1/auth_endpoints.py` router

Kept in its own file/router (mounted at `/api/v1/auth`) rather than added to
the already-large `endpoints.py` — auth is its own concern with its own
dependency (`get_current_user`) that other future routes will import.

- `POST /auth/signup` `{email, password, display_name}` → 409 if email taken,
  else creates the user, hashes the password, sets both cookies, returns
  `{id, email, display_name}`.
- `POST /auth/login` `{email, password}` → 401 on bad credentials, else same
  cookie-setting + user info response.
- `POST /auth/logout` (CSRF-protected) → clears both cookies.
- `GET /auth/me` → 401 if no valid session, else the current user's info. Used
  by the frontend on page load to know whether someone's logged in.

`get_current_user(request: Request) -> UserModel` dependency: reads the
`session` cookie, calls `decode_access_token`, 401s if `None` or the user id
doesn't exist in the DB, else loads and returns the `UserModel`. Imported by
both the auth router (for `/auth/me`) and the predictions router.

## Prediction game — new `app/services/predictions_service.py` + endpoints in `auth_endpoints.py`'s sibling router (or appended to `endpoints.py` — see Task breakdown)

- `POST /predictions` `{year, event_name, predicted_p1, predicted_p2, predicted_p3}`
  (requires `get_current_user` + CSRF): validates all three are distinct driver
  codes (reuses `FALLBACK_2024_DRIVERS` code list the same way `strategy_simulator`
  validates compounds), checks the event's session hasn't started yet (FastF1
  event schedule lookup — the same `fastf1.get_event_schedule` call already used
  in `/races/historical` — scanning that event row's `Session1`..`Session5`
  columns to find the one whose value is `"Race"`, then reading the matching
  `SessionNDate`, since the Race session isn't always `Session5` on a Sprint
  weekend; comparing that timestamp against `datetime.utcnow()`), then upserts (one prediction per
  user per race — resubmitting before the race starts overwrites the previous
  pick).
- `GET /predictions/me?year=` (requires `get_current_user`): the current user's
  predictions for that year.
- `GET /leaderboard?year=`: `SELECT user_id, SUM(points_awarded), display_name
  GROUP BY user_id ORDER BY total DESC` for that year, joined against `users`
  for the display name. No auth required — a leaderboard is public by nature.
- `POST /predictions/score` `{year, event_name}`: fetches the real result for
  that race (`f1_service` already has FastF1/Ergast access), then for every
  `PredictionModel` row matching that `(year, event_name)`: awards **25
  points** if `predicted_p1/p2/p3` exactly match the real top 3 in order, else
  **10 points** per driver correctly named anywhere in the real top 3
  (position-independent partial credit), else **0**. Writes `points_awarded`
  on each row. Idempotent (safe to call again — it recomputes and overwrites,
  it doesn't add). Not authenticated: it only *reads* real official results and
  *writes* points that are a pure function of those results plus each user's
  own already-submitted (and now-locked, since the race started) prediction —
  a malicious caller gains nothing by triggering it early or often.

## Frontend

- `axios.defaults.withCredentials = true` (set alongside the existing
  `axios.defaults.baseURL` in `AppInitializer.tsx`) so cookies flow on every
  request.
- An axios request interceptor reads the `csrf_token` cookie and sets
  `X-CSRF-Token` on it for `POST`/`PUT`/`DELETE` requests.
- New store slice: `currentUser: {id, email, display_name} | null`, populated by
  calling `/auth/me` once on app load (401 just means logged-out, not an error
  to surface).
- New `/login` page (email/password form, a link to switch to signup mode).
- New `/predictions` page: if logged out, prompts to log in; if logged in,
  shows the upcoming-race prediction form (three driver-code selects) and the
  leaderboard for the selected year.

## Error handling

| Case | Behavior |
|---|---|
| Wrong password / unknown email | 401, generic "invalid credentials" (never reveal which part was wrong) |
| Signup with taken email | 409 |
| Expired/tampered JWT cookie | `get_current_user` → 401 |
| Missing/mismatched CSRF header | `verify_csrf` → 403 |
| Prediction submitted after race start | 400, clear message with the race's actual start time |
| Prediction with an invalid/unknown driver code | 400 |
| `/predictions/score` called for a race with no real result yet | 400 (not silently 0-scored) |

## Testing

- `auth_service.py`: pure function tests for hash/verify round-trip, wrong
  password rejection, token create/decode round-trip, expired-token rejection,
  tampered-signature rejection.
- Auth endpoints: `TestClient`-based, covering signup → cookies set → `/auth/me`
  returns the user; wrong password → 401; duplicate signup → 409; CSRF
  mismatch on a mutating route → 403.
- `predictions_service.py`: pure scoring-function tests (exact match = 25,
  partial = 10 each, none = 0) using fabricated real-result data, no FastF1 call.
- Prediction endpoints: submitting before/after a fabricated race start time
  (monkeypatched schedule lookup), leaderboard aggregation math.
- **A dedicated security-review pass** (this session's `security-review` skill)
  over the auth code specifically, after implementation and before considering
  this phase done — not a substitute for the tests above, an additional
  adversarial check given the risk profile.

## Rollout notes

- New table migrations: this project doesn't have an Alembic migration system —
  `Base.metadata.create_all()` in `main.py`'s lifespan already creates any new
  table on startup (as it does today for `sessions`/`drivers`/`laps`), so no
  new migration tooling is needed for these two new tables.
- `requirements.txt` gains explicit `PyJWT` and `bcrypt` entries (both already
  present transitively, but the code now imports them directly).
