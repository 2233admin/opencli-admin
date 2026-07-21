from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest
from sqlalchemy import func, select

from backend.models.plugin_installation import PluginInstallation
from backend.models.studio import StudioWorkflowDraft
from backend.workflow.dify_graphon_client import DifyGraphonClient

FIXTURE = Path(__file__).parents[1] / "fixtures" / "dify_plugins" / "tool_manifest.yaml"


async def test_plugin_catalog_returns_every_bundled_provider_group(client):
    response = await client.get("/api/v1/plugins")

    assert response.status_code == 200
    bundled = {
        item["id"]: item for item in response.json()["data"] if item["sourceKind"] == "bundled"
    }
    assert set(bundled) == {
        "bundled:agent-runtime",
        "bundled:delivery",
        "bundled:dify-graphon-runtime",
        "bundled:http-api",
        "bundled:model-runtime",
        "bundled:native-data-sources",
        "bundled:opencli-adapters",
        "bundled:schedule-trigger",
        "bundled:workflow-bundles",
    }
    assert bundled["bundled:workflow-bundles"]["runtimeStatus"] == "READY"
    assert bundled["bundled:workflow-bundles"]["capabilities"][0]["key"] == "workflow-bundles"


@pytest.mark.parametrize(
    ("healthy", "plugin_status", "catalog_status", "backend_available"),
    [
        (True, "READY", "runnable", True),
        (False, "BLOCKED", "blocked", False),
    ],
)
async def test_graphon_catalog_status_follows_the_live_runtime_probe(
    client,
    monkeypatch,
    healthy,
    plugin_status,
    catalog_status,
    backend_available,
):
    async def probe(_self):
        return healthy

    monkeypatch.setattr(DifyGraphonClient, "is_healthy", probe)

    plugins = (await client.get("/api/v1/plugins")).json()["data"]
    graphon = next(item for item in plugins if item["id"] == "bundled:dify-graphon-runtime")
    assert graphon["runtimeStatus"] == plugin_status
    assert graphon["nodeDefinitions"][0]["locked"] is (not healthy)

    catalog = (await client.get("/api/v1/workflows/capabilities")).json()["data"]["catalog"]
    package = next(item for item in catalog if item["id"] == "package.compat.dify-workflow")
    assert package["status"] == catalog_status
    assert package["backendAvailable"] is backend_available
    assert package["runtimeBinding"] == "workflow.compat.dify.graphon"


def _difypkg(manifest: bytes, *, provider: bytes | None = None) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.yaml", manifest)
        if provider is not None:
            archive.writestr("provider/research.yaml", provider)
        archive.writestr("main.py", "raise RuntimeError('must not execute')\n")
    return output.getvalue()


async def _import(client, content: bytes, filename: str = "manifest.yaml"):
    return await client.post(
        "/api/v1/plugins/import/dify",
        files={"file": (filename, content, "application/octet-stream")},
    )


async def test_manifest_import_persists_blocked_capabilities_and_lists(client, db_session):
    response = await _import(client, FIXTURE.read_bytes())
    assert response.status_code == 201
    installed = response.json()["data"]
    assert installed["providerKey"] == "example/research_tools"
    assert installed["sourceKind"] == "manifest"
    assert installed["manifestSpecVersion"] == "0.0.2"
    assert installed["runtimeStatus"] == "BLOCKED"
    assert {item["family"] for item in installed["capabilities"]} == {"tool", "model"}
    assert all(item["status"] == "BLOCKED" for item in installed["capabilities"])
    assert installed["nodeDefinitions"][0]["locked"] is True
    assert installed["nodeDefinitions"][0]["installationId"] == installed["id"]
    assert installed["nodeDefinitions"][0]["pluginVersion"] == "1.2.3"

    assert await db_session.scalar(select(func.count()).select_from(PluginInstallation)) == 1
    listing = await client.get("/api/v1/plugins")
    assert listing.status_code == 200
    rows = listing.json()["data"]
    assert any(row["id"] == installed["id"] for row in rows)
    assert any(row["sourceKind"] == "bundled" for row in rows)

    detail = await client.get(f"/api/v1/plugins/{installed['id']}")
    assert detail.status_code == 200
    assert detail.json()["data"]["sourceDigest"] == installed["sourceDigest"]

    workflow_capabilities = await client.get("/api/v1/workflows/capabilities")
    assert workflow_capabilities.status_code == 200
    catalog = workflow_capabilities.json()["data"]["catalog"]
    dify_runtime = next(item for item in catalog if item["id"] == "package.compat.dify-workflow")
    assert dify_runtime["runtimeBinding"] == "workflow.compat.dify.graphon"
    locked = next(
        item
        for item in catalog
        if item["manifest"].get("plugin", {}).get("installationId") == installed["id"]
    )
    assert locked["status"] == "blocked"
    assert locked["manifest"]["canvas"]["locked"] is True
    assert locked["manifest"]["plugin"]["version"] == "1.2.3"


async def test_difypkg_import_reads_metadata_and_required_credentials(client):
    provider = b"""identity:
  name: research
credentials_for_provider:
  - name: api_key
    type: secret-input
    required: true
"""
    response = await _import(
        client,
        _difypkg(FIXTURE.read_bytes(), provider=provider),
        "research.difypkg",
    )
    assert response.status_code == 201
    installed = response.json()["data"]
    assert installed["sourceKind"] == "difypkg"
    assert installed["permissions"]["requiredCredentials"] == [
        {
            "name": "api_key",
            "type": "secret-input",
            "required": True,
            "sourcePath": "provider/research.yaml",
        }
    ]
    assert "raise RuntimeError" not in str(installed)


async def test_duplicate_import_is_idempotent_and_version_conflict_is_stable(client, db_session):
    first = await _import(client, FIXTURE.read_bytes())
    second = await _import(client, FIXTURE.read_bytes())
    assert first.status_code == second.status_code == 201
    assert first.json()["data"]["id"] == second.json()["data"]["id"]
    assert await db_session.scalar(select(func.count()).select_from(PluginInstallation)) == 1

    changed = FIXTURE.read_bytes().replace(b"Metadata-only test", b"Changed test metadata")
    conflict = await _import(client, changed)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "dify_plugin_version_conflict"


async def test_invalid_yaml_and_missing_fields_return_stable_422(client):
    invalid = await _import(client, b"plugins: [")
    assert invalid.status_code == 422
    assert invalid.json()["detail"]["code"] == "dify_plugin_manifest_invalid_yaml"

    missing = await _import(client, b"type: plugin\nmeta:\n  version: 0.0.1\n")
    assert missing.status_code == 422
    assert missing.json()["detail"]["code"] == "dify_plugin_manifest_field_missing"


async def test_uninstall_deletes_unreferenced_and_protects_durable_drafts(client, db_session):
    installed = (await _import(client, FIXTURE.read_bytes())).json()["data"]
    db_session.add(
        StudioWorkflowDraft(
            workflow_id="workflow-fixture",
            revision=1,
            graph={
                "nodes": [
                    {
                        "id": "plugin-node",
                        "params": {"pluginInstallationId": installed["id"]},
                    }
                ]
            },
            updated_by_user_id="test-user",
        )
    )
    await db_session.flush()

    blocked = await client.delete(f"/api/v1/plugins/{installed['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "plugin_installation_in_use"

    draft = await db_session.scalar(select(StudioWorkflowDraft))
    await db_session.delete(draft)
    await db_session.flush()
    deleted = await client.delete(f"/api/v1/plugins/{installed['id']}")
    assert deleted.status_code == 200
    assert await db_session.get(PluginInstallation, installed["id"]) is None


async def test_bundled_plugin_cannot_be_uninstalled(client):
    response = await client.delete("/api/v1/plugins/bundled:opencli-adapters")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "bundled_plugin_cannot_uninstall"
