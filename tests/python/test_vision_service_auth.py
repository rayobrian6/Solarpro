"""
tests/python/test_vision_service_auth.py

THE RENDER VISION SERVICES ANSWER ONLY SOLARPRO.

SAM2 (/segment, /segment-prompted, /depth — CORS "*") and the OpenCV photo
vision worker (/v1/photo-vision/jobs, /vision/match-features,
/vision/estimate-homography) had no authentication; the worker also fetched
any caller-supplied URL, following redirects, and wrote job results into the
website database keyed by a caller-supplied job id.

Drives the REAL FastAPI apps through TestClient (without the startup hook, so
no model is loaded — a request that clears auth fails later on validation,
which is exactly the proof that auth let it through).

Run: python -m pytest tests/python -q
"""

from __future__ import annotations

import importlib
import os
import socket
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
SAM2_DIR = ROOT / "sam2-service"
OPENCV_DIR = ROOT / "external-workers" / "opencv-photo-vision"
TOKEN = "test-vision-token-0123456789abcdef"


def _load(dir_: Path, module: str):
    sys.path.insert(0, str(dir_))
    try:
        return importlib.import_module(module)
    finally:
        sys.path.remove(str(dir_))


@pytest.fixture(scope="module")
def sam2_app():
    return _load(SAM2_DIR, "main").app


@pytest.fixture(scope="module")
def opencv_mod():
    return _load(OPENCV_DIR, "app.main")


@pytest.fixture(autouse=True)
def token_env(monkeypatch):
    monkeypatch.setenv("VISION_SERVICE_TOKEN", TOKEN)


def auth(token: str = TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


SAM2_PROTECTED = [("post", "/segment"), ("post", "/segment-prompted"), ("post", "/depth"),
                  ("get", "/openapi.json"), ("get", "/docs")]
OPENCV_PROTECTED = [("post", "/v1/photo-vision/jobs"), ("get", "/v1/photo-vision/jobs/abc"),
                    ("delete", "/v1/photo-vision/jobs/abc"), ("post", "/vision/match-features"),
                    ("post", "/vision/estimate-homography"), ("get", "/openapi.json")]


# ── SAM2 ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("method,path", SAM2_PROTECTED)
def test_sam2_refuses_anonymous_and_wrong_token(sam2_app, method, path):
    c = TestClient(sam2_app)
    assert getattr(c, method)(path).status_code == 401
    assert getattr(c, method)(path, headers=auth("wrong-token")).status_code == 401
    assert getattr(c, method)(path, headers={"Authorization": TOKEN}).status_code == 401  # no scheme


@pytest.mark.parametrize("method,path", SAM2_PROTECTED)
def test_sam2_lets_the_right_token_through(sam2_app, method, path):
    res = getattr(TestClient(sam2_app), method)(path, headers=auth())
    assert res.status_code != 401  # 422 (no file) / 200 (docs) — past the gate


def test_sam2_health_stays_public(sam2_app):
    assert TestClient(sam2_app).get("/health").status_code != 401


def test_sam2_fails_closed_without_a_configured_token(sam2_app, monkeypatch):
    monkeypatch.delenv("VISION_SERVICE_TOKEN", raising=False)
    res = TestClient(sam2_app).post("/segment", headers=auth())
    assert res.status_code == 401
    assert "not configured" in res.json()["detail"]


def test_sam2_no_longer_grants_cors_to_any_origin(sam2_app):
    res = TestClient(sam2_app).options(
        "/segment", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert res.headers.get("access-control-allow-origin") not in ("*", "https://evil.example")


# ── OpenCV worker ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("method,path", OPENCV_PROTECTED)
def test_opencv_refuses_anonymous_and_wrong_token(opencv_mod, method, path):
    c = TestClient(opencv_mod.app)
    assert getattr(c, method)(path).status_code == 401
    assert getattr(c, method)(path, headers=auth("wrong-token")).status_code == 401


@pytest.mark.parametrize("method,path", OPENCV_PROTECTED)
def test_opencv_lets_the_right_token_through(opencv_mod, method, path):
    res = getattr(TestClient(opencv_mod.app), method)(path, headers=auth())
    assert res.status_code != 401


def test_opencv_fails_closed_without_a_configured_token(opencv_mod, monkeypatch):
    monkeypatch.delenv("VISION_SERVICE_TOKEN", raising=False)
    res = TestClient(opencv_mod.app).post("/vision/match-features", headers=auth(), json={})
    assert res.status_code == 401


def test_opencv_authorized_request_cannot_reach_the_metadata_endpoint(opencv_mod):
    """Even the authenticated caller cannot make the worker fetch internal addresses."""
    body = {"image1Url": "http://169.254.169.254/latest/meta-data/", "image2Url": "http://127.0.0.1:8080/x"}
    res = TestClient(opencv_mod.app).post("/vision/match-features", headers=auth(), json=body)
    assert res.status_code != 401
    assert "non-public" in res.text or "not allowed" in res.text or "blocked" in res.text.lower()


# ── URL guard ───────────────────────────────────────────────────────────────

def _guard():
    return _load(OPENCV_DIR, "app.url_guard")


def fake_resolver(mapping: dict[str, str]):
    def resolve(host, port, proto=0, **_):
        if host not in mapping:
            raise socket.gaierror("no such host")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (mapping[host], port))]
    return resolve


@pytest.mark.parametrize("url", [
    "file:///etc/passwd", "gopher://example.com/", "ftp://example.com/x",
    "http://127.0.0.1/", "http://localhost/", "http://10.0.0.5/", "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[::ffff:127.0.0.1]/",
    "http://100.64.0.1/", "http://0.0.0.0/",
])
def test_guard_refuses_internal_and_non_http_urls(url):
    g = _guard()
    with pytest.raises(g.BlockedFetchError):
        g.validate_fetch_url(url, resolver=fake_resolver({"localhost": "127.0.0.1"}) if "localhost" in url else None)


def test_guard_allows_a_public_host():
    g = _guard()
    g.validate_fetch_url("https://photos.example.com/a.jpg", resolver=fake_resolver({"photos.example.com": "93.184.216.34"}))


def test_guard_refuses_a_public_name_that_resolves_internally():
    g = _guard()
    with pytest.raises(g.BlockedFetchError):
        g.validate_fetch_url("https://rebind.example.com/", resolver=fake_resolver({"rebind.example.com": "10.1.2.3"}))


def test_guard_host_allowlist(monkeypatch):
    g = _guard()
    monkeypatch.setenv("FETCH_ALLOWED_HOSTS", ".blob.vercel-storage.com,site-survey-api-bpyz.onrender.com")
    r = fake_resolver({"abc.public.blob.vercel-storage.com": "76.76.21.21",
                       "site-survey-api-bpyz.onrender.com": "216.24.57.1",
                       "evil.example.com": "93.184.216.34"})
    g.validate_fetch_url("https://abc.public.blob.vercel-storage.com/p.jpg", resolver=r)
    g.validate_fetch_url("https://site-survey-api-bpyz.onrender.com/uploads/p.jpg", resolver=r)
    with pytest.raises(g.BlockedFetchError):
        g.validate_fetch_url("https://evil.example.com/p.jpg", resolver=r)


def test_guard_checks_every_redirect_hop(monkeypatch):
    """A public URL that redirects to an internal one is stopped at the redirect."""
    g = _guard()
    monkeypatch.setattr(g.socket, "getaddrinfo",
                        fake_resolver({"public.example.com": "93.184.216.34", "127.0.0.1": "127.0.0.1"}))
    hits: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        hits.append(str(request.url))
        if request.url.host == "public.example.com":
            return httpx.Response(302, headers={"Location": "http://127.0.0.1/secret"})
        return httpx.Response(200, content=b"internal secret")

    client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True,
                          event_hooks={"request": [g.guard_request]})
    with pytest.raises(g.BlockedFetchError):
        client.get("https://public.example.com/start")
    assert hits == ["https://public.example.com/start"]  # the internal hop was never sent


def test_the_two_service_auth_copies_are_identical():
    assert (SAM2_DIR / "service_auth.py").read_bytes() == (OPENCV_DIR / "app" / "service_auth.py").read_bytes()
