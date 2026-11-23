"""Вход через Apple и Google: проверяем их подпись и выдаём наш собственный токен сессии."""
from __future__ import annotations

import time

import jwt
from jwt import PyJWKClient

GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
APPLE_JWKS = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"

_jwks: dict[str, PyJWKClient] = {}


class AuthError(Exception):
    pass


def _client(url: str) -> PyJWKClient:
    if url not in _jwks:
        _jwks[url] = PyJWKClient(url, cache_keys=True, lifespan=3600)
    return _jwks[url]


def _verify(token: str, jwks_url: str, audiences: list[str], issuers) -> dict:
    if not audiences:
        raise AuthError("Вход этим способом не настроен на сервере")
    try:
        key = _client(jwks_url).get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=["RS256"], audience=audiences,
                            options={"require": ["exp", "iat", "sub"]})
    except jwt.PyJWTError as e:
        raise AuthError(f"Токен входа не прошёл проверку: {e}") from e
    if claims.get("iss") not in issuers:
        raise AuthError("Токен выдан не тем сервисом")
    return claims


def verify_google(id_token: str, client_ids: list[str]) -> dict:
    return _verify(id_token, GOOGLE_JWKS, client_ids, GOOGLE_ISSUERS)


def verify_apple(identity_token: str, bundle_ids: list[str]) -> dict:
    return _verify(identity_token, APPLE_JWKS, bundle_ids, (APPLE_ISSUER,))


def issue_session(user_id: int, secret: str, days: int = 60) -> str:
    now = int(time.time())
    return jwt.encode({"sub": str(user_id), "iat": now, "exp": now + days * 86400, "typ": "session"},
                      secret, algorithm="HS256")


def read_session(token: str, secret: str) -> int:
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise AuthError("Сессия истекла, войдите снова") from e
    if claims.get("typ") != "session":
        raise AuthError("Неверный токен")
    return int(claims["sub"])
