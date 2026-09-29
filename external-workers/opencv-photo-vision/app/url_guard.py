"""
Outbound fetch guard for caller-supplied image URLs (SSRF).

The worker fetches `fileUrl` values it is handed and followed redirects
anywhere, so a caller could point it at Render's internal network, the cloud
metadata endpoint or localhost and read the response back through the job
result. Authentication (service_auth.py) is the primary control; this is
defence in depth for URLs that ultimately come from survey data.

Every request the fetch client makes — the first one AND each redirect hop —
is checked by `guard_request`, installed as an httpx request event hook:

  * scheme must be http or https;
  * if FETCH_ALLOWED_HOSTS is set (comma-separated; an entry starting with
    '.' matches that domain and its subdomains), the host must match it;
  * every address the host resolves to must be public — loopback, private,
    link-local (incl. 169.254.169.254 metadata), CGNAT, multicast, reserved
    and unspecified addresses are refused.
"""

from __future__ import annotations

import ipaddress
import os
import socket
from urllib.parse import urlsplit

import httpx

ALLOWED_SCHEMES = frozenset({"http", "https"})


class BlockedFetchError(ValueError):
    """Raised when a URL may not be fetched."""


def _allowed_hosts() -> list[str]:
    raw = os.environ.get("FETCH_ALLOWED_HOSTS", "")
    return [h.strip().lower() for h in raw.split(",") if h.strip()]


def _host_allowed(host: str, allowed: list[str]) -> bool:
    for entry in allowed:
        if entry.startswith("."):
            if host == entry[1:] or host.endswith(entry):
                return True
        elif host == entry:
            return True
    return False


def _is_public(addr: str) -> bool:
    ip = ipaddress.ip_address(addr)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
            or ip.is_reserved or ip.is_unspecified):
        return False
    # 100.64.0.0/10 (carrier-grade NAT) is not flagged private by ipaddress.
    if isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.ip_network("100.64.0.0/10"):
        return False
    return True


def validate_fetch_url(url: str, resolver=None) -> None:
    """Raise BlockedFetchError unless `url` is safe to fetch."""
    resolver = resolver or socket.getaddrinfo
    parts = urlsplit(str(url))
    scheme = (parts.scheme or "").lower()
    if scheme not in ALLOWED_SCHEMES:
        raise BlockedFetchError(f"scheme '{scheme}' is not allowed")
    host = (parts.hostname or "").lower()
    if not host:
        raise BlockedFetchError("URL has no host")

    allowed = _allowed_hosts()
    if allowed and not _host_allowed(host, allowed):
        raise BlockedFetchError(f"host '{host}' is not in FETCH_ALLOWED_HOSTS")

    try:
        infos = resolver(host, parts.port or (443 if scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise BlockedFetchError(f"host '{host}' does not resolve: {exc}") from exc
    addrs = {info[4][0] for info in infos}
    if not addrs:
        raise BlockedFetchError(f"host '{host}' does not resolve")
    for addr in addrs:
        if not _is_public(addr):
            raise BlockedFetchError(f"host '{host}' resolves to a non-public address")


def guard_request(request: httpx.Request) -> None:
    """httpx request event hook — runs for the first request and every redirect."""
    validate_fetch_url(str(request.url))


def guarded_client(timeout: float) -> httpx.Client:
    """The only client the worker may use for caller-supplied URLs."""
    return httpx.Client(timeout=timeout, follow_redirects=True, event_hooks={"request": [guard_request]})
