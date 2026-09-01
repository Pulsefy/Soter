"""
Adversarial multi-tenant isolation tests for artifact access (issue #989).

Proves that one organization cannot reach another organization's evidence
artifacts across EVERY endpoint that touches artifacts:

- POST /v1/ai/verification-artifacts/{artifact_id}/access  (direct id)
- GET  /v1/ai/verification-artifacts/download?token=...    (indirect via
  signed token)
- POST /v1/ai/humanitarian/verify                          (indirect via
  ``artifact_ids`` references)
- /v1/ai/evidence-uploads/sessions/*                       (indirect artifact
  path; scoped by per-user owner instead of org - also covered)

Guarantees under test:

1. Cross-tenant access is denied on every endpoint, for direct ids AND
   indirect reference paths.
2. Denials are indistinguishable from "artifact does not exist" responses
   (same status code + body), so an attacker cannot enumerate other orgs'
   artifact IDs.
3. Cache keys embed the tenant scope (``org_id``), so one tenant can never be
   served a cached response computed for another tenant.
4. Every denial is recorded in the audit trail.
5. Path traversal cannot escape the artifacts directory to reach other
   tenants' files.
"""

import json
from unittest.mock import Mock, patch

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

import main
from schemas.errors import ErrorDetail, ErrorEnvelope
from services import cache as cache_module
from services.evidence_access_control import EvidenceAccessControl

ORG_A = "org-alpha"
ORG_B = "org-bravo"

AID_CLAIM = "Family of 5 displaced by flood needs food and shelter"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def artifacts_env(tmp_path):
    """Real artifacts directory containing one artifact per tenant."""
    import api.v1.artifacts as artifacts_module

    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir(parents=True)

    def _write_artifact(artifact_id: str, org_id: str, content: bytes):
        (artifact_dir / artifact_id).write_bytes(content)
        (artifact_dir / f"{artifact_id}.meta.json").write_text(
            json.dumps(
                {
                    "org_id": org_id,
                    "filename": f"{artifact_id}",
                    "mime_type": "application/octet-stream",
                }
            ),
            encoding="utf-8",
        )

    _write_artifact("alpha-evidence.bin", ORG_A, b"org-a-secret-evidence")
    _write_artifact("bravo-evidence.bin", ORG_B, b"org-b-secret-evidence")

    # Repoint the shared module-level service used by the artifacts router
    # (same pattern as tests/test_artifact_access.py).
    original_dir = artifacts_module.artifact_access_service.artifacts_dir
    artifacts_module.artifact_access_service.artifacts_dir = str(artifact_dir.resolve())
    yield {
        "dir": artifact_dir,
        "service": artifacts_module.artifact_access_service,
        "write": _write_artifact,
    }
    artifacts_module.artifact_access_service.artifacts_dir = original_dir


@pytest.fixture()
def client(artifacts_env, tmp_path):
    """TestClient over an app wiring BOTH artifact-touching routers with the
    real (unmocked) access-control stack pointed at the shared temp dir."""
    import api.v1.uploads as uploads_module

    app = FastAPI(title="Multi-Tenant Isolation Tests")

    from api.v1.artifacts import router as artifacts_router
    from api.v1.humanitarian import router as humanitarian_router
    from api.v1.uploads import router as uploads_router

    # Keep upload chunks out of the repository working tree.
    original_storage_dir = uploads_module.upload_session_service.storage_dir
    uploads_module.upload_session_service.storage_dir = str(tmp_path / "uploads")

    app.include_router(artifacts_router, prefix="/v1")
    app.include_router(humanitarian_router, prefix="/v1")
    app.include_router(uploads_router, prefix="/v1")

    # Mirror main.app's HTTPException -> ErrorEnvelope handler so denial
    # bodies have exactly the production shape.
    from fastapi.exceptions import HTTPException as FastAPIHTTPException
    from starlette.exceptions import HTTPException as StarletteHTTPException

    async def _http_exception_handler(request, exc):
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorEnvelope(
                error=ErrorDetail(
                    code=f"HTTP_{exc.status_code}", message=str(exc.detail)
                )
            ).model_dump(),
        )

    app.add_exception_handler(FastAPIHTTPException, _http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)

    # Real access-control stack sharing the repointed artifacts directory.
    app.state.artifact_access_control = EvidenceAccessControl(artifacts_env["service"])
    app.state.humanitarian_verification_service = Mock()
    app.state.humanitarian_verification_service.verify_claim = Mock(
        return_value={
            "provider": "test",
            "model": "test-provider/fixture",
            "prompt_variant": "primary",
            "verification": {"verdict": "credible", "confidence": 0.9},
        }
    )
    app.state.humanitarian_verification_service.get_model_version = Mock(
        return_value="test:test-provider/fixture"
    )
    # Cache disabled by default; tenant-scope cache tests enable a mock.
    app.state.cache = Mock(enabled=False)

    yield TestClient(app, follow_redirects=False)

    uploads_module.upload_session_service.storage_dir = original_storage_dir


@pytest.fixture(autouse=True)
def reset_singleflight_state():
    """Keep services.cache module-level single-flight bookkeeping from
    leaking keys/results between tests."""
    cache_module._inflight_computations.clear()
    cache_module._inflight_results.clear()
    cache_module._inflight_errors.clear()
    yield
    cache_module._inflight_computations.clear()
    cache_module._inflight_results.clear()
    cache_module._inflight_errors.clear()


def _verify_payload(artifact_ids=None):
    payload = {
        "aid_claim": AID_CLAIM,
        "supporting_evidence": ["photo"],
        "context_factors": {},
        "provider_preference": "test",
    }
    if artifact_ids is not None:
        payload["artifact_ids"] = artifact_ids
    return payload


def _verify_headers(org=ORG_A, role="operator", user="user-a"):
    return {"X-Org-Id": org, "X-User-Id": user, "X-User-Role": role}


# ---------------------------------------------------------------------------
# Direct id access: POST /v1/ai/verification-artifacts/{id}/access
# ---------------------------------------------------------------------------


class TestDirectArtifactAccessIsolation:
    def _access(self, client, artifact_id, mode="signed_url", **header_overrides):
        headers = _verify_headers(**header_overrides)
        return client.post(
            f"/v1/ai/verification-artifacts/{artifact_id}/access",
            headers=headers,
            json={"mode": mode},
        )

    @pytest.mark.parametrize("mode", ["signed_url", "proxy"])
    def test_cross_org_direct_access_denied(self, client, mode):
        """Org A must not mint a URL for nor proxy-read Org B's artifact."""
        response = self._access(client, "bravo-evidence.bin", mode=mode, org=ORG_A)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "artifact_not_found"

    def test_cross_org_denial_indistinguishable_from_missing(self, client):
        """The denial for an existing foreign artifact must be byte-for-byte
        identical to the response for a nonexistent id (no existence leak)."""
        forbidden = self._access(client, "bravo-evidence.bin", org=ORG_A)
        missing = self._access(client, "does-not-exist.bin", org=ORG_A)

        assert forbidden.status_code == missing.status_code == 404
        assert forbidden.content == missing.content

    def test_same_org_access_still_allowed(self, client):
        response = self._access(client, "alpha-evidence.bin", org=ORG_A)
        assert response.status_code == 200
        assert "download_url" in response.json()

    @pytest.mark.parametrize(
        "spoofed_org", [ORG_B.upper(), f" {ORG_B}", f"{ORG_B} ", "org-BRAVO"]
    )
    def test_org_header_normalization_attacks_denied(
        self, client, spoofed_org, artifacts_env
    ):
        """Case/whitespace tricks must never satisfy ownership checks."""
        response = self._access(client, "bravo-evidence.bin", org=spoofed_org)
        assert response.status_code == 404

    @pytest.mark.parametrize(
        "traversal_id",
        [
            "../artifacts/bravo-evidence.bin",
            "..%2Fbravo-evidence.bin",
            "..\\bravo-evidence.bin",
            "%2e%2e%2fbravo-evidence.bin",
            "....//bravo-evidence.bin",
        ],
    )
    def test_path_traversal_cannot_reach_other_tenant_files(self, client, traversal_id):
        response = self._access(client, traversal_id, org=ORG_A)
        assert response.status_code in (
            403,
            404,
        ), "traversal attempt must never serve another tenant's file"

    def test_missing_headers_fail_closed_for_foreign_artifact(self, client):
        for drop in ("X-Org-Id", "X-User-Id", "X-User-Role"):
            headers = _verify_headers()
            headers.pop(drop)
            response = client.post(
                "/v1/ai/verification-artifacts/bravo-evidence.bin/access",
                headers=headers,
                json={"mode": "proxy"},
            )
            assert (
                response.status_code == 400
            ), f"{drop} must be required when artifact ids are referenced"

    def test_invalid_role_cannot_read_foreign_artifact(self, client):
        response = self._access(client, "bravo-evidence.bin", role="superadmin")
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "forbidden_role"

    def test_cross_org_proxy_mode_never_serves_file_contents(
        self, client, artifacts_env
    ):
        """Even a bug elsewhere must not leak bytes: proxy mode for a foreign
        artifact must not return Org B's payload."""
        response = self._access(client, "bravo-evidence.bin", mode="proxy")
        assert b"org-b-secret-evidence" not in response.content


# ---------------------------------------------------------------------------
# Indirect reference path 1: signed-token download
# ---------------------------------------------------------------------------


class TestSignedTokenDownloadIsolation:
    def test_forged_token_for_other_org_denied_like_missing(
        self, client, artifacts_env
    ):
        """A validly-signed token whose embedded org doesn't own the artifact
        must get the same generic 404 as an unknown artifact."""
        service = artifacts_env["service"]
        forged = service.create_signed_token("bravo-evidence.bin", ORG_A, "user-a")

        response = client.get(f"/v1/ai/verification-artifacts/download?token={forged}")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "artifact_not_found"

        unknown = client.get(
            "/v1/ai/verification-artifacts/download?token=%s"
            % service.create_signed_token("ghost.bin", ORG_B, "user-b")
        )
        assert unknown.status_code == 404
        assert unknown.content == response.content

    def test_token_rebinding_artifact_id_is_rejected(self, client, artifacts_env):
        """Re-signing an attacker-chosen payload pointing Org B's token at Org
        A's artifact requires the signing secret; verify tampered payloads are
        rejected rather than trusted."""
        service = artifacts_env["service"]
        token_b = service.create_signed_token("bravo-evidence.bin", ORG_B, "user-b")

        # Flip the embedded artifact id inside the payload without re-signing.
        import base64

        payload_b64, sig_b64 = token_b.split(".", 1)
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        payload["aid"] = "alpha-evidence.bin"
        new_payload_b64 = (
            base64.urlsafe_b64encode(
                json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
            )
            .decode()
            .rstrip("=")
        )

        response = client.get(
            "/v1/ai/verification-artifacts/download"
            f"?token={new_payload_b64}.{sig_b64}"
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "invalid_token_signature"

    def test_cross_org_token_never_leaks_file_contents(self, client, artifacts_env):
        service = artifacts_env["service"]
        forged = service.create_signed_token("bravo-evidence.bin", ORG_A, "user-a")
        response = client.get(f"/v1/ai/verification-artifacts/download?token={forged}")
        assert b"org-b-secret-evidence" not in response.content


# ---------------------------------------------------------------------------
# Indirect reference path 2: POST /v1/ai/humanitarian/verify (artifact_ids)
# ---------------------------------------------------------------------------


class TestHumanitarianVerifyReferenceIsolation:
    def test_single_foreign_reference_denied(self, client):
        response = client.post(
            "/v1/ai/humanitarian/verify",
            headers=_verify_headers(org=ORG_A),
            json=_verify_payload(["bravo-evidence.bin"]),
        )
        assert response.status_code == 403

    def test_mixed_own_and_foreign_list_denied_atomically(self, client):
        """One foreign id in the list must deny the whole request (no partial
        processing of the attacker's own artifacts alongside stolen ones)."""
        response = client.post(
            "/v1/ai/humanitarian/verify",
            headers=_verify_headers(org=ORG_A),
            json=_verify_payload(["alpha-evidence.bin", "bravo-evidence.bin"]),
        )
        assert response.status_code == 403
        client.app.state.humanitarian_verification_service.verify_claim.assert_not_called()

    def test_denial_body_does_not_leak_existence_or_ownership(self, client):
        """Foreign-existing vs nonexistent references must produce identical,
        generic denials that name neither the artifact nor its owner."""
        foreign = client.post(
            "/v1/ai/humanitarian/verify",
            headers=_verify_headers(org=ORG_A),
            json=_verify_payload(["bravo-evidence.bin"]),
        )
        ghost = client.post(
            "/v1/ai/humanitarian/verify",
            headers=_verify_headers(org=ORG_A),
            json=_verify_payload(["ghost-evidence.bin"]),
        )
        assert foreign.status_code == ghost.status_code == 403
        assert foreign.json() == ghost.json()

        body_text = json.dumps(foreign.json())
        assert "not found" not in body_text.lower()
        assert "different organization" not in body_text.lower()
        assert "bravo-evidence" not in body_text
        assert ORG_B.lower() not in body_text.lower()

    def test_all_roles_enforced_for_foreign_references(self, client):
        for role in ("operator", "reviewer", "admin"):
            svc = client.app.state.humanitarian_verification_service
            svc.verify_claim.reset_mock()
            response = client.post(
                "/v1/ai/humanitarian/verify",
                headers=_verify_headers(org=ORG_A, role=role),
                json=_verify_payload(["bravo-evidence.bin"]),
            )
            assert response.status_code == 403, f"role={role} must be denied"
            svc.verify_claim.assert_not_called()

    def test_whitespace_only_org_header_fail_closed(self, client):
        response = client.post(
            "/v1/ai/humanitarian/verify",
            headers=_verify_headers(org="   "),
            json=_verify_payload(["bravo-evidence.bin"]),
        )
        assert response.status_code == 400

    def test_missing_role_header_fail_closed(self, client):
        headers = _verify_headers()
        del headers["X-User-Role"]
        response = client.post(
            "/v1/ai/humanitarian/verify",
            headers=headers,
            json=_verify_payload(["bravo-evidence.bin"]),
        )
        assert response.status_code == 400

    def test_denial_is_audit_logged_with_real_reason(self, client, caplog):
        import logging

        with caplog.at_level(logging.WARNING):
            client.post(
                "/v1/ai/humanitarian/verify",
                headers=_verify_headers(org=ORG_A),
                json=_verify_payload(["bravo-evidence.bin"]),
            )

        denied = [
            r
            for r in caplog.records
            if getattr(r, "event", None) == "evidence_access_check"
            and getattr(r, "status", "") == "denied"
        ]
        assert denied, "cross-org denial must be audit logged"
        assert any(getattr(r, "reason", "") == "forbidden_org" for r in denied)

    def test_same_org_reference_allowed(self, client):
        response = client.post(
            "/v1/ai/humanitarian/verify",
            headers=_verify_headers(org=ORG_B, user="user-b"),
            json=_verify_payload(["bravo-evidence.bin"]),
        )
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# Indirect reference path 3: resumable evidence-upload sessions
# ---------------------------------------------------------------------------


class TestUploadSessionTenantIsolation:
    """Upload sessions are scoped by owner user id rather than org id; a
    different user must not be able to read, append to, or finalize someone
    else's session (which assembles into an artifact)."""

    def _create_session(self, client, user):
        response = client.post(
            "/v1/ai/evidence-uploads/sessions",
            headers={"X-User-Id": user},
            json={
                "filename": "evidence.jpg",
                "content_type": "image/jpeg",
                "total_size": 11,
                "total_chunks": 1,
            },
        )
        assert response.status_code == 200
        return response.json()["session_id"]

    def test_other_user_cannot_read_session_state(self, client):
        session_id = self._create_session(client, "user-a")
        response = client.get(
            f"/v1/ai/evidence-uploads/sessions/{session_id}",
            headers={"X-User-Id": "user-b"},
        )
        assert response.status_code == 403
        assert "forbidden_owner" in response.json()["error"]["message"]

    def test_other_user_cannot_inject_chunks(self, client):
        session_id = self._create_session(client, "user-a")
        response = client.put(
            f"/v1/ai/evidence-uploads/sessions/{session_id}/chunks/0",
            headers={"X-User-Id": "user-b"},
            files={"chunk": ("chunk.bin", b"evil-bytes!", "application/octet-stream")},
        )
        assert response.status_code == 403

    def test_other_user_cannot_finalize_into_an_artifact(self, client):
        session_id = self._create_session(client, "user-a")
        # Owner uploads their only chunk...
        owner_upload = client.put(
            f"/v1/ai/evidence-uploads/sessions/{session_id}/chunks/0",
            headers={"X-User-Id": "user-a"},
            files={"chunk": ("chunk.bin", b"hello-world", "application/octet-stream")},
        )
        assert owner_upload.status_code == 200
        # ...but an attacker must not be able to finalize it into an artifact
        # under their control.
        response = client.post(
            f"/v1/ai/evidence-uploads/sessions/{session_id}/finalize",
            headers={"X-User-Id": "user-b"},
        )
        assert response.status_code == 403

    def test_empty_owner_header_fail_closed_on_existing_session(self, client):
        session_id = self._create_session(client, "user-a")
        response = client.get(
            f"/v1/ai/evidence-uploads/sessions/{session_id}",
            headers={"X-User-Id": ""},
        )
        assert response.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Cache key tenant scoping
# ---------------------------------------------------------------------------


class TestCacheKeyTenantScope:
    def _enabled_cache(self):
        mock_cache = Mock()
        mock_cache.enabled = True
        mock_cache.get.return_value = None
        mock_cache.set.return_value = True
        # Mock._generate_key() returns the same MagicMock on every call
        # by default, which tricks the single-flight suppression into
        # thinking two different requests share a cache key.  We need a
        # deterministic side_effect that:
        #   * returns the SAME string for identical inputs (so the same
        #     tenant's repeat request is a cache hit)
        #   * returns DIFFERENT strings when kwargs differ (e.g. org_id)
        #   * embeds org_id literally so tests can assert tenant scoping
        import hashlib
        import json as _json

        def _realistic_key(prefix, *args, tags=None, **kwargs):
            sorted_kwargs = sorted(kwargs.items())
            key_data = {"args": args, "kwargs": sorted_kwargs}
            h = hashlib.sha256(
                _json.dumps(key_data, sort_keys=True, default=str).encode()
            ).hexdigest()[:12]
            tag_seg = ""
            if tags:
                parts = sorted(
                    f"{n}={v}" for n, v in tags.items() if v not in (None, "")
                )
                if parts:
                    tag_seg = ":" + ":".join(parts)
            return f"cache:ai:{prefix}{tag_seg}:{h}"

        mock_cache._generate_key.side_effect = _realistic_key
        return mock_cache

    def test_cache_keys_differ_per_tenant(self, client):
        """Identical verification requests from two tenants must produce
        distinct cache keys carrying each org's scope tag."""
        mock_cache = self._enabled_cache()
        with patch.object(main.app.state, "cache", mock_cache, create=True):
            for org in (ORG_A, ORG_B):
                response = client.post(
                    "/v1/ai/humanitarian/verify",
                    headers=_verify_headers(org=org),
                    json=_verify_payload(),  # no artifact refs -> pure claim text
                )
                assert response.status_code == 200

        set_keys = [call.args[0] for call in mock_cache.set.call_args_list]
        assert len(set_keys) == 2, "both tenants should populate their own entry"
        key_a, key_b = set_keys
        assert key_a != key_b, "cache keys must be scoped per tenant"
        assert f"org_id={ORG_A}" in key_a
        assert f"org_id={ORG_B}" in key_b

    def test_tenant_never_served_cached_response_of_other_tenant(self, client):
        mock_cache = self._enabled_cache()
        svc = client.app.state.humanitarian_verification_service

        with patch.object(main.app.state, "cache", mock_cache, create=True):
            # Tenant A populates the cache.
            client.post(
                "/v1/ai/humanitarian/verify",
                headers=_verify_headers(org=ORG_A),
                json=_verify_payload(),
            )
            key_a = mock_cache.set.call_args_list[0].args[0]

            # Serve Tenant A's entry from cache on lookup.
            cached_result = mock_cache.set.call_args_list[0].args[1]
            mock_cache.get.side_effect = lambda key: (
                cached_result if key == key_a else None
            )

            svc.verify_claim.reset_mock()
            # Tenant B sends the exact same claim text.
            client.post(
                "/v1/ai/humanitarian/verify",
                headers=_verify_headers(org=ORG_B),
                json=_verify_payload(),
            )

            # Tenant B must NOT be served Tenant A's cached computation...
            served_key = mock_cache.set.call_args_list[-1].args[0]
            assert served_key != key_a
            # ...and must trigger its own underlying computation.
            svc.verify_claim.assert_called_once()

    def test_same_tenant_repeat_hits_own_scoped_entry(self, client):
        mock_cache = self._enabled_cache()
        svc = client.app.state.humanitarian_verification_service

        with patch.object(main.app.state, "cache", mock_cache, create=True):
            for _ in range(2):
                client.post(
                    "/v1/ai/humanitarian/verify",
                    headers=_verify_headers(org=ORG_A),
                    json=_verify_payload(),
                )

        assert mock_cache.get.call_count >= 2
        assert (
            mock_cache.set.call_count == 1
        ), "repeat request by same tenant should hit its own scoped entry"


# ---------------------------------------------------------------------------
# Cache invalidation surface
# ---------------------------------------------------------------------------


class TestInvalidateCacheEndpointIsolation:
    def test_reviewer_cannot_trigger_invalidation_for_foreign_artifact(self, client):
        response = client.post(
            "/v1/ai/verification-artifacts/bravo-evidence.bin/invalidate-cache",
            headers={"X-User-Role": "reviewer"},
        )
        assert response.status_code == 403

    def test_invalidation_requires_role_even_for_own_artifact(self, client):
        response = client.post(
            "/v1/ai/verification-artifacts/alpha-evidence.bin/invalidate-cache"
        )
        assert response.status_code == 403
