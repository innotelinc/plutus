#!/usr/bin/env python3
"""provision_authentik.py — wire Cerulean Authentik (SSO) into PLUTUS.

Idempotent, stdlib-only, talks to the Authentik REST API (no UI clicks):

  1. ensures the admin group (default: plutus-admins) exists
  2. ensures the "PLUTUS SSO" OIDC provider exists (confidential client,
     redirect_uri = <PUBLIC_URL>/auth/callback, groups scope included)
  3. ensures the "PLUTUS" application exists, bound to that provider
  4. adds the bootstrap admin user to the admin group
  5. writes AUTHENTIK_CLIENT_ID / AUTHENTIK_CLIENT_SECRET into .env.local
     (only when it created the provider)

Safe to re-run after a fresh Authentik boot. Requires AUTHENTIK_TOKEN (the
bootstrap token from Cerulean's .env) and a reachable Authentik instance.

Usage:
    python3 scripts/provision-authentik.py [--env-file .env.local] \
        [--auth-host http://127.0.0.1:9000] [--token <AUTHENTIK_TOKEN>]

The token is read from --token, else the AUTHENTIK_TOKEN / AUTHENTIK_BOOTSTRAP_TOKEN
entry in the env file, else CERULEAN_DIR/.env (the Cerulean repo's own .env).
"""

from __future__ import annotations

import argparse
import json
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent
DEFAULT_ENV = REPO / ".env.local"
AUTH_HOST = "http://127.0.0.1:9000"
API_PREFIX = "/api/v3"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip().strip('"').strip("'")
    return env


def save_env(path: Path, updates: dict[str, str]) -> None:
    lines = path.read_text().splitlines() if path.exists() else []
    for key, val in updates.items():
        replaced = False
        for i, line in enumerate(lines):
            if line.startswith(f"{key}="):
                lines[i] = f"{key}={val}"
                replaced = True
                break
        if not replaced:
            lines.append(f"{key}={val}")
    path.write_text("\n".join(lines) + "\n")


class AkApi:
    def __init__(self, base: str, token: str):
        self.base = base.rstrip("/")
        self.token = token

    def _call(self, method: str, path: str, body: Any = None) -> Any:
        url = f"{self.base}{path}"
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Authorization": f"Bearer {self.token}", "Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            detail = (e.read() or b"").decode(errors="replace")[:300]
            raise RuntimeError(f"{method} {path} → HTTP {e.code}: {detail}") from e

    def get_all(self, path: str) -> list[dict]:
        """Paginate a list endpoint (Authentik paginates with ?page / pagination)."""
        out: list[dict] = []
        page = 1
        while True:
            sep = "&" if "?" in path else "?"
            res = self._call("GET", f"{path}{sep}page={page}&page_size=100")
            if not isinstance(res, dict):
                out.extend(res or [])
                break
            out.extend(res.get("results") or [])
            nxt = (res.get("pagination") or {}).get("next")
            if not nxt or page >= nxt:
                break
            page += 1
        return out


def find_by(rows: list[dict], **kw) -> dict | None:
    for r in rows:
        if all(r.get(k) == v for k, v in kw.items()):
            return r
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default=str(DEFAULT_ENV))
    parser.add_argument("--auth-host", default=AUTH_HOST, help="Authentik API base (default http://127.0.0.1:9000)")
    parser.add_argument("--token", default="", help="Authentik API token (default: env file, then Cerulean .env)")
    parser.add_argument("--cerulean-dir", default="", help="Cerulean repo dir to read AUTHENTIK_BOOTSTRAP_TOKEN from")
    args = parser.parse_args()

    env = load_env(Path(args.env_file))
    token = args.token or env.get("AUTHENTIK_TOKEN") or env.get("AUTHENTIK_BOOTSTRAP_TOKEN", "")

    if not token:
        # Fall back to the Cerulean repo's own .env (bootstrap token).
        cerulean_dir = Path(args.cerulean_dir or REPO.parent / "cerulean-dns-platform")
        cerulean_env = load_env(cerulean_dir / ".env")
        token = cerulean_env.get("AUTHENTIK_BOOTSTRAP_TOKEN", "")
    if not token:
        print("FAIL AUTHENTIK_BOOTSTRAP_TOKEN missing — set --token or CERULEAN_DIR, then re-run", file=sys.stderr)
        return 1

    api = AkApi(args.auth_host, token)

    # PUBLIC_URL is what the browser uses to reach the app (cookie is set on
    # this origin via the nginx /auth/ proxy). The OIDC redirect_uri must
    # match it exactly.
    public_url = env.get("PUBLIC_URL", "http://127.0.0.1:3000").rstrip("/")
    app_url = public_url
    redirect_uri = f"{public_url}/auth/callback"
    admin_group = env.get("AUTHENTIK_ADMIN_GROUP", "plutus-admins")
    bootstrap_email = env.get("AUTHENTIK_BOOTSTRAP_EMAIL", "")

    try:
        # 1. Admin group
        groups = api.get_all(f"{API_PREFIX}/core/groups/")
        grp = find_by(groups, name=admin_group)
        if grp is None:
            grp = api._call("POST", f"{API_PREFIX}/core/groups/", {"name": admin_group})
            print(f"PASS created group {admin_group} (pk {grp['pk']})")
        else:
            print(f"PASS group {admin_group} already exists")

        # 2. OIDC provider. NOTE: this Authentik version serves providers at
        # /api/v3/providers/oauth2/ (no `core/` prefix) — /providers/oidc/ and
        # /core/providers/oauth2/ both 404. Groups/applications/users keep the
        # `core/` prefix below.
        providers = api.get_all(f"{API_PREFIX}/providers/oauth2/")
        prov = find_by(providers, name="PLUTUS SSO")
        if prov is None:
            # authorization flow: implicit consent (no consent screen);
            # invalidation flow is required by this Authentik version.
            flows = api.get_all(f"{API_PREFIX}/flows/instances/")
            auth_flow = find_by(flows, slug="default-provider-authorization-implicit-consent")
            invalid_flow = find_by(flows, slug="default-provider-invalidation-flow")
            if auth_flow is None:
                print("FAIL could not find the default implicit-consent authorization flow", file=sys.stderr)
                return 1
            if invalid_flow is None:
                print("FAIL could not find the default invalidation flow", file=sys.stderr)
                return 1
            # signing key: reuse an existing PLUTUS pair, else generate one
            # (this Authentik version requires common_name + validity_days)
            keys = api.get_all(f"{API_PREFIX}/crypto/certificatekeypairs/")
            key = find_by(keys, name="PLUTUS Signing Key") or find_by(keys, name="plutus-signing")
            if key is None:
                key = api._call("POST", f"{API_PREFIX}/crypto/certificatekeypairs/generate/", {
                    "name": "PLUTUS Signing Key",
                    "common_name": "plutus-signing",
                    "validity_days": 3650,
                })
            # OIDC scope property mappings. Names vary between Authentik
            # versions ("OIDC Mapping" vs "OAuth Mapping", and the groups map
            # may be platform-customized), so match on the scope_name suffix
            # and reuse the same pks the rest of the platform uses.
            scopes = api.get_all(f"{API_PREFIX}/propertymappings/provider/scope/")
            scope_ids = []
            for want in ["openid", "profile", "email", "groups"]:
                m = find_by(scopes, scope_name=want)
                if m:
                    scope_ids.append(m["pk"])
            if len(scope_ids) < 4:
                # Fall back to the platform-known pks (this Cerulean deploy).
                known = [
                    "90c10b21-babd-4a68-8e55-e8b1caeb8c04",  # groups (Innotel)
                    "6c78e0c1-a6b3-4446-b945-26b6adeb2ebc",  # email
                    "369b13da-9ef0-4592-b15e-2edf4b7addd2",  # profile
                    "9edf050c-3bc1-4dee-b59e-62eee652fdaa",  # openid
                ]
                scope_ids = known
            client_id = "plutus-" + secrets.token_hex(6)
            client_secret = secrets.token_urlsafe(32)
            prov = api._call("POST", f"{API_PREFIX}/providers/oauth2/", {
                "name": "PLUTUS SSO",
                "client_type": "confidential",
                "client_id": client_id,
                "client_secret": client_secret,
                "authorization_flow": auth_flow["pk"],
                "invalidation_flow": invalid_flow["pk"],
                # grant_types must be explicit or authorize 302s with
                # "Invalid grant_type for provider" in this Authentik version.
                "grant_types": ["authorization_code", "hybrid", "implicit", "refresh_token"],
                # This Authentik version expects structured redirect URIs.
                "redirect_uris": [{
                    "matching_mode": "strict",
                    "url": redirect_uri,
                    "redirect_uri_type": "authorization",
                }],
                "signing_key": key["pk"],
                "property_mappings": scope_ids,
                "sub_mode": "hashed_user_id",
                "issuer_mode": "per_provider",
            })
            print(f"PASS created OIDC provider 'PLUTUS SSO' (pk {prov['pk']})")
            save_env(Path(args.env_file), {
                "AUTHENTIK_CLIENT_ID": client_id,
                "AUTHENTIK_CLIENT_SECRET": client_secret,
            })
            print("PASS wrote AUTHENTIK_CLIENT_ID / AUTHENTIK_CLIENT_SECRET to .env.local")
        else:
            # Ensure the redirect_uri matches the current PUBLIC_URL (hosts
            # change between LAN/deploy — Authentik matches it strictly), and
            # that grant_types / property_mappings are non-empty (an empty
            # grant_types makes authorize reject with "Invalid grant_type").
            current = [r.get("url") for r in (prov.get("redirect_uris") or [])]
            patch: dict[str, Any] = {}
            if redirect_uri not in current:
                patch["redirect_uris"] = [{
                    "matching_mode": "strict",
                    "url": redirect_uri,
                    "redirect_uri_type": "authorization",
                }]
            if not (prov.get("grant_types") or []):
                patch["grant_types"] = ["authorization_code", "hybrid", "implicit", "refresh_token"]
            if not (prov.get("property_mappings") or []):
                scopes = api.get_all(f"{API_PREFIX}/propertymappings/provider/scope/")
                scope_ids = []
                for want in ["openid", "profile", "email", "groups"]:
                    m = find_by(scopes, scope_name=want)
                    if m:
                        scope_ids.append(m["pk"])
                if len(scope_ids) < 4:
                    scope_ids = [
                        "90c10b21-babd-4a68-8e55-e8b1caeb8c04",
                        "6c78e0c1-a6b3-4446-b945-26b6adeb2ebc",
                        "369b13da-9ef0-4592-b15e-2edf4b7addd2",
                        "9edf050c-3bc1-4dee-b59e-62eee652fdaa",
                    ]
                patch["property_mappings"] = scope_ids
            if patch:
                prov = api._call("PATCH", f"{API_PREFIX}/providers/oauth2/{prov['pk']}/", patch)
                print(f"PASS patched provider: {list(patch.keys())}")
            else:
                print("PASS OIDC provider 'PLUTUS SSO' already exists (all fields match)")

        # 3. Application bound to the provider
        apps = api.get_all(f"{API_PREFIX}/core/applications/")
        app = find_by(apps, slug="plutus")
        if app is None:
            app = api._call("POST", f"{API_PREFIX}/core/applications/", {
                "name": "PLUTUS",
                "slug": "plutus",
                "provider": prov["pk"],
                "launch_url": app_url,
            })
            print(f"PASS created application 'PLUTUS' (slug plutus)")
        else:
            print("PASS application 'PLUTUS' already exists")

        # 4. Bootstrap admin → admin group
        # This Authentik version manages membership via the `users` field on
        # the group (POST /groups/<pk>/users/ 404s).
        if bootstrap_email:
            users = api.get_all(f"{API_PREFIX}/core/users/")
            admin_user = find_by(users, email=bootstrap_email)
            if admin_user is not None:
                grp = api._call("PATCH", f"{API_PREFIX}/core/groups/{grp['pk']}/", {
                    "users": list(grp.get("users") or []) + [admin_user["pk"]],
                })
                print(f"PASS added {bootstrap_email} to {admin_group}")
            else:
                print(f"WARN bootstrap admin {bootstrap_email} not found yet — Authentik may still be booting")
        else:
            print("SKIP admin-group membership (AUTHENTIK_BOOTSTRAP_EMAIL not set)")

        print(f"PASS Authentik provisioned — redirect_uri: {redirect_uri}")
        print("  Next: set the convex env vars and push (see README → AI keys / SSO).")
        return 0
    except (RuntimeError, urllib.error.URLError, OSError) as e:
        print(f"FAIL Authentik provisioning error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())