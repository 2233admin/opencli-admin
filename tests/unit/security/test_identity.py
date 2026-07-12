import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jose import jwk, jwt

from backend.security.identity import (
    IdentitySettings,
    OIDCVerifier,
    RequestIdentity,
    identity_dependency,
)

PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PRIVATE_PEM = PRIVATE_KEY.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)
PUBLIC_JWK = jwk.construct(PRIVATE_KEY.public_key(), "RS256").to_dict()


def _app(dependency):
    app = FastAPI()

    @app.get("/me")
    async def me(identity: RequestIdentity = Depends(dependency)):
        return identity.__dict__

    return app


def test_bootstrap_admin_fallback():
    dependency = identity_dependency(
        IdentitySettings("https://id.example", "api", bootstrap_admin_token="rescue")
    )
    response = TestClient(_app(dependency)).get("/me", headers={"Authorization": "Bearer rescue"})
    assert response.status_code == 200
    assert response.json()["subject"] == "bootstrap-admin"
    assert response.json()["is_platform_admin"] is True


def test_missing_bearer_is_rejected():
    dependency = identity_dependency(IdentitySettings("https://id.example", "api"))
    response = TestClient(_app(dependency)).get("/me")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_development_identity_is_allowed_only_from_loopback(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    dependency = identity_dependency(IdentitySettings("https://id.example", "api"))
    response = TestClient(_app(dependency), client=("127.0.0.1", 50000)).get(
        "/me", headers={"X-OpenCLI-Development-Identity": "local-development"}
    )
    assert response.status_code == 200
    assert response.json()["subject"] == "bootstrap-admin"
    assert response.json()["auth_method"] == "development"


def test_development_identity_is_rejected_outside_development(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    dependency = identity_dependency(IdentitySettings("https://id.example", "api"))
    response = TestClient(_app(dependency)).get(
        "/me", headers={"X-OpenCLI-Development-Identity": "local-development"}
    )
    assert response.status_code == 401


def test_development_identity_is_rejected_from_non_loopback(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    dependency = identity_dependency(IdentitySettings("https://id.example", "api"))
    response = TestClient(_app(dependency), client=("192.0.2.1", 50000)).get(
        "/me", headers={"X-OpenCLI-Development-Identity": "local-development"}
    )
    assert response.status_code == 401


def test_development_identity_rejects_non_loopback_browser_origin(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    dependency = identity_dependency(IdentitySettings("https://id.example", "api"))
    response = TestClient(_app(dependency), client=("127.0.0.1", 50000)).get(
        "/me",
        headers={
            "X-OpenCLI-Development-Identity": "local-development",
            "Origin": "http://192.0.2.1:3000",
        },
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_oidc_verifies_issuer_audience_and_jwks(monkeypatch):
    settings = IdentitySettings("https://id.example", "opencli", "https://id.example/jwks")
    public_jwk = {**PUBLIC_JWK, "kid": "one"}
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"keys": [public_jwk]})
    )
    token = jwt.encode(
        {
            "sub": "user-1",
            "iss": settings.issuer,
            "aud": settings.audience,
            "email": "u@example.com",
        },
        PRIVATE_PEM,
        algorithm="RS256",
        headers={"kid": "one"},
    )
    async with httpx.AsyncClient(transport=transport) as client:
        identity = await OIDCVerifier(settings, client=client).verify(token)
    assert identity.subject == "user-1"
    assert identity.email == "u@example.com"


@pytest.mark.asyncio
async def test_oidc_rejects_wrong_audience():
    settings = IdentitySettings("https://id.example", "wrong", "https://id.example/jwks")
    public_jwk = {**PUBLIC_JWK, "kid": "one"}
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"keys": [public_jwk]})
    )
    token = jwt.encode(
        {"sub": "user-1", "iss": settings.issuer, "aud": "opencli"},
        PRIVATE_PEM,
        algorithm="RS256",
        headers={"kid": "one"},
    )
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(Exception) as error:
            await OIDCVerifier(settings, client=client).verify(token)
    assert error.value.status_code == 401
