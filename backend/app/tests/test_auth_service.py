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


def test_verify_password_rejects_passwords_longer_than_bcrypts_72_byte_limit():
    hashed = hash_password("a-normal-password")
    assert verify_password("x" * 100, hashed) is False


def test_verify_password_returns_false_for_a_malformed_stored_hash():
    assert verify_password("anything", "not-a-bcrypt-hash") is False
