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
