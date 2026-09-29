"""
Shared-secret bearer authentication for SolarPro's Render vision services.

These services used to answer every caller on the internet: SAM2's /segment,
/segment-prompted and /depth (with CORS "*"), and the OpenCV worker's
/v1/photo-vision/jobs, /vision/match-features and /vision/estimate-homography
(which fetch caller-supplied URLs and write job results into the website
database). Their only legitimate callers are SolarPro server-side code
(Vercel routes and the geometry-reconstruction worker), so every path except
the health probe Render uses now requires

    Authorization: Bearer <VISION_SERVICE_TOKEN>

compared in constant time. A service with NO token configured refuses every
protected request (fail closed) and says so in the response and the log — it
never falls back to open.

Both refusals are 401, not 503: the website clients retry 502/503 as a cold
start, and a misconfiguration must fail fast instead of burning the retry
budget.

This file is duplicated verbatim in sam2-service/service_auth.py and
external-workers/opencv-photo-vision/app/service_auth.py — the two services
deploy from separate roots and cannot share a module. Keep them identical
(tests/python/test_vision_service_auth.py checks that they are).
"""

from __future__ import annotations

import hmac
import logging
import os

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

TOKEN_ENV = "VISION_SERVICE_TOKEN"

# Render's health check must stay reachable without a secret. Nothing else.
PUBLIC_PATHS = frozenset({"/health"})

logger = logging.getLogger("service_auth")


def configured_token() -> str:
    return os.environ.get(TOKEN_ENV, "").strip()


def log_auth_configuration() -> None:
    """Call once at startup so a missing token is visible in the service log."""
    if configured_token():
        logger.info("service auth: %s is set — protected endpoints require a bearer token", TOKEN_ENV)
    else:
        logger.error(
            "service auth: %s is NOT set — every protected endpoint will answer 401 "
            "until it is configured (fail closed)", TOKEN_ENV,
        )


def _unauthorized(detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=401, headers={"WWW-Authenticate": "Bearer"})


class ServiceAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        expected = configured_token()
        if not expected:
            return _unauthorized("service authentication is not configured on this service")

        header = request.headers.get("authorization", "")
        scheme, _, presented = header.partition(" ")
        presented = presented.strip()
        if scheme.lower() != "bearer" or not presented:
            return _unauthorized("missing bearer token")
        if not hmac.compare_digest(presented.encode("utf-8"), expected.encode("utf-8")):
            return _unauthorized("invalid bearer token")

        return await call_next(request)
