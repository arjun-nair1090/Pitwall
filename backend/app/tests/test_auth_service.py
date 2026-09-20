from app.services.auth_service import hash_password, verify_password


def test_hash_password_round_trips_with_verify():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", hashed) is True


def test_verify_password_rejects_wrong_password():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("wrong password", hashed) is False


def test_hash_password_uses_a_random_salt_each_time():
    hashed_a = hash_password("same password")
    hashed_b = hash_password("same password")
    assert hashed_a != hashed_b


from datetime import timedelta

from app.services.auth_service import create_access_token, decode_access_token


def test_create_and_decode_access_token_round_trips():
    token = create_access_token(user_id=42)
    assert decode_access_token(token) == 42


def test_decode_access_token_rejects_expired_token():
    token = create_access_token(user_id=42, expires_delta=timedelta(seconds=-1))
    assert decode_access_token(token) is None


def test_decode_access_token_rejects_malformed_token():
    assert decode_access_token("not.a.valid.jwt") is None


def test_decode_access_token_rejects_token_signed_with_a_different_key():
    import jwt as pyjwt
    bad_token = pyjwt.encode({"sub": "42"}, "wrong-secret", algorithm="HS256")
    assert decode_access_token(bad_token) is None


import pytest

from app.services.auth_service import get_token_jti, is_token_revoked, revoke_token


class FakeRedisClient:
    """In-memory stand-in for redis.asyncio.Redis -- just the two calls auth_service uses."""

    def __init__(self):
        self._store = {}

    async def set(self, key, value, ex=None):
        self._store[key] = value

    async def exists(self, key):
        return 1 if key in self._store else 0


def test_create_access_token_includes_a_jti_claim():
    token = create_access_token(user_id=42)
    assert get_token_jti(token) is not None


def test_two_tokens_for_the_same_user_have_different_jtis():
    token_a = create_access_token(user_id=42)
    token_b = create_access_token(user_id=42)
    assert get_token_jti(token_a) != get_token_jti(token_b)


@pytest.mark.asyncio
async def test_revoke_token_makes_is_token_revoked_true(monkeypatch):
    import app.services.auth_service as auth_service_module
    fake_client = FakeRedisClient()
    monkeypatch.setattr(auth_service_module.redis_service, "client", fake_client)

    assert await is_token_revoked("some-jti") is False
    await revoke_token("some-jti", ttl_seconds=60)
    assert await is_token_revoked("some-jti") is True


@pytest.mark.asyncio
async def test_is_token_revoked_defaults_to_false_when_redis_unavailable(monkeypatch):
    import app.services.auth_service as auth_service_module
    monkeypatch.setattr(auth_service_module.redis_service, "client", None)

    assert await is_token_revoked("any-jti") is False
