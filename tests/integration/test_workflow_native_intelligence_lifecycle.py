import hashlib
import json
import logging
import os
import socket
import sqlite3
import urllib.request
from copy import deepcopy
from pathlib import Path

import httpx
import pytest
import requests
from sqlalchemy import event, func, select
from sqlalchemy.exc import OperationalError

import backend.database as database_module
import backend.workflow.intelligence_store as intelligence_store_module
import backend.workflow.native_intelligence_executor as native_executor
import backend.workflow.tool_capabilities as tool_capability_registry
from backend.auth import crypto
from backend.database import commit_session
from backend.models.intelligence import (
    IntelligenceArtifact,
    IntelligenceArtifactReference,
    IntelligenceCommandRecord,
    IntelligenceOutbox,
    IntelligenceSession,
    IntelligenceTransition,
)
from backend.models.workflow_run import WorkflowRunEvent
from backend.workflow.capability_projection import build_workflow_capabilities
from backend.workflow.event_mirror import (
    list_workflow_event_mirror_records,
    reset_memory_workflow_event_mirror,
)
from backend.workflow.intelligence_store import IntelligenceStore, IntelligenceStoreError
from backend.workflow.native_intelligence_contracts import (
    ARTIFACT_SIMULATION_EXPECTATIONS,
    ArtifactProvenance,
    InterviewArtifact,
    ReportArtifact,
    canonical_hash,
)
from backend.workflow.native_intelligence_executor import (
    _ACTION_HANDLERS,
    _RESOURCE_GATE_RESOLVERS,
    NATIVE_INTELLIGENCE_ACTION_BY_NAME,
    NATIVE_INTELLIGENCE_ACTIONS,
    _output_session_ref,
    certify_native_intelligence_action,
    native_intelligence_action_manifest,
)
from backend.workflow.opencli_hda_tracer import _RUNS
from backend.workflow.runtime_contracts import RUNTIME_IO_CONTRACTS


def _project() -> dict:
    return {
        "id": "wf-native-intelligence-lifecycle",
        "name": "Native intelligence lifecycle",
        "profile": "intelligence",
        "version": 1,
        "nodes": [
            {
                "id": "native-lifecycle",
                "kind": "agent",
                "capability": "normalize",
                "params": {
                    "template": "native-intelligence-lifecycle",
                    "runtime": "iii",
                    "lockedInternals": True,
                    "offline": True,
                    "credentialFree": True,
                    "fixtureId": "native-intelligence-offline-v1",
                },
                "ui": {"catalogId": "package.intelligence.native-lifecycle"},
            }
        ],
        "edges": [],
        "adapters": [],
        "agentPermissions": {
            "canFetchNetwork": False,
            "canSendNotifications": False,
            "canWriteInbox": True,
        },
    }


def _editor_added_project() -> dict:
    project = _project()
    implementation = project["nodes"][0]
    implementation["id"] = "native-operator-implementation"
    implementation["ui"]["networkRole"] = "implementation"
    project["id"] = "wf-editor-added-native-intelligence"
    project["name"] = "Editor-added native intelligence lifecycle"
    project["nodes"] = [
        {
            "id": "existing-output",
            "kind": "inbox",
            "capability": "store",
            "params": {"queue": "existing-output", "archive": False},
        },
        {
            "id": "native-operator",
            "kind": "agent",
            "capability": "normalize",
            "params": {
                "operator": {
                    "execution": "internals",
                    "implementationCatalogId": (
                        "package.intelligence.native-lifecycle"
                    ),
                    "implementationNodeId": implementation["id"],
                }
            },
            "internals": {
                "locked": False,
                "nodes": [implementation],
                "edges": [],
            },
        },
    ]
    return project


def _action_project(action: str) -> dict:
    return {
        "id": f"wf-native-{action.replace('.', '-')}",
        "name": f"Native {action}",
        "profile": "intelligence",
        "version": 1,
        "nodes": [
            {
                "id": "native-action",
                "kind": "action",
                "capability": "store",
                "params": {
                    "toolCapability": {
                        "id": f"tool.intelligence.native.{action}",
                        "executor": {
                            "mode": "native_intelligence",
                            "params": {"action": action},
                        },
                    },
                    "toolParams": {},
                },
                "ui": {"catalogId": "external.tool.capability"},
            }
        ],
        "edges": [],
        "adapters": [],
    }


def _action_chain_project(
    actions: list[str],
    *,
    first_params: dict | None = None,
) -> dict:
    nodes = []
    for index, action in enumerate(actions):
        tool_params = dict(first_params or {}) if index == 0 else {}
        if action == "research":
            tool_params["fixtureId"] = "native-intelligence-offline-v1"
            tool_params["sourceMode"] = "offline_fixture"
        nodes.append(
            {
                "id": action.replace(".", "-"),
                "kind": "action",
                "capability": "store",
                "params": {
                    "toolCapability": {
                        "id": f"tool.intelligence.native.{action}",
                        "executor": {
                            "mode": "native_intelligence",
                            "params": {"action": action},
                        },
                    },
                    "toolParams": tool_params,
                },
                "ui": {"catalogId": "external.tool.capability"},
            }
        )
    return {
        "id": f"wf-native-chain-{actions[0].replace('.', '-')}",
        "name": "Native action chain",
        "profile": "intelligence",
        "version": 1,
        "nodes": nodes,
        "edges": [
            {
                "id": f"edge-{index}",
                "source": nodes[index]["id"],
                "target": nodes[index + 1]["id"],
                "sourcePort": "out",
                "targetPort": "in",
            }
            for index in range(len(nodes) - 1)
        ],
        "adapters": [],
    }


def _raw_ref_action_project() -> dict:
    return _action_chain_project(["research", "ontology"])


async def _intelligence_row_counts(db_session) -> tuple[int, ...]:
    models = (
        IntelligenceSession,
        IntelligenceArtifact,
        IntelligenceArtifactReference,
        IntelligenceCommandRecord,
        IntelligenceTransition,
        IntelligenceOutbox,
    )
    counts = []
    for model in models:
        count = await db_session.scalar(select(func.count()).select_from(model))
        counts.append(int(count or 0))
    return tuple(counts)


def _malform_research_manifest(manifest: dict, case: str) -> None:
    runtime_contract = manifest.get("runtimeContract")
    if case == "runtime_inputs":
        runtime_contract.pop("inputShape")
    elif case == "runtime_outputs":
        runtime_contract["outputShape"] = None
    elif case == "runtime_errors":
        runtime_contract.pop("errors")
    elif case == "resource_gate":
        manifest["resourceGate"] = None
    elif case == "event_contract":
        manifest["eventShape"] = {"events": "partial"}
    elif case == "provenance":
        manifest["provenance"] = []
    elif case == "limits":
        manifest["limits"] = None
    elif case == "action":
        manifest["action"] = "ontology"
    elif case == "action_binding":
        manifest["runtime"].pop("actionBinding")
    elif case == "mutates":
        manifest["runtime"]["mutates"] = "true"
    elif case == "fixture":
        manifest["fixtureEvidence"] = None
    elif case == "gate_shape":
        manifest["configGate"] = {"required": None}
    else:
        raise AssertionError(f"unknown malformed manifest case: {case}")


def test_native_action_readiness_truth_table_cannot_be_promoted(monkeypatch, tmp_path):
    action = NATIVE_INTELLIGENCE_ACTION_BY_NAME["research"]
    manifest = native_intelligence_action_manifest(action)
    assert manifest["readiness"]["predicates"] == {
        "executor_registered": True,
        "contract_complete": True,
        "fixture_evidence_registered": True,
        "gates_resolvable": True,
    }
    original = _ACTION_HANDLERS.pop("research")
    executor_case = certify_native_intelligence_action(action, manifest)
    _ACTION_HANDLERS["research"] = original

    invalid_contract = deepcopy(manifest)
    invalid_contract["runtimeContract"]["outputShape"]["ports"][0]["type"] = "wrong"
    contract_case = certify_native_intelligence_action(action, invalid_contract)

    invalid_fixture = deepcopy(manifest)
    invalid_fixture["fixtureEvidence"]["transcriptHash"] = "invalid"
    fixture_case = certify_native_intelligence_action(action, invalid_fixture)
    wrong_action_fixture = deepcopy(manifest)
    wrong_action_fixture["fixtureEvidence"]["scenario"] = {
        "id": "wrong",
        "action": "ontology",
        "expectedState": "ontology_ready",
    }
    wrong_action_case = certify_native_intelligence_action(action, wrong_action_fixture)

    invalid_gate = deepcopy(manifest)
    invalid_gate["resourceGate"]["required"].append("unregistered_resource")
    invalid_gate["readiness"] = {"status": "runnable", "runnable": True}
    gate_case = certify_native_intelligence_action(action, invalid_gate)
    removed_gate = deepcopy(manifest)
    removed_gate["resourceGate"]["required"] = []
    removed_gate_case = certify_native_intelligence_action(action, removed_gate)
    ontology = NATIVE_INTELLIGENCE_ACTION_BY_NAME["ontology"]
    cross_action_contract = deepcopy(manifest)
    cross_action_case = certify_native_intelligence_action(
        ontology,
        cross_action_contract,
    )
    monkeypatch.setitem(
        _RESOURCE_GATE_RESOLVERS,
        "database_session",
        {"resolver": "not-callable", "blockReason": "database_unavailable"},
    )
    malformed_resolver_case = certify_native_intelligence_action(action, manifest)
    monkeypatch.setitem(
        _RESOURCE_GATE_RESOLVERS,
        "database_session",
        {"resolver": lambda _context: True},
    )
    missing_reason_case = certify_native_intelligence_action(action, manifest)
    monkeypatch.delitem(
        RUNTIME_IO_CONTRACTS,
        "workflow.native-intelligence.research",
    )
    missing_registry_contract = native_intelligence_action_manifest(action)
    monkeypatch.setattr(
        native_executor,
        "_FIXTURE_PATH",
        Path("missing-native-intelligence-fixture.json"),
    )
    missing_fixture_manifest = native_intelligence_action_manifest(action)
    malformed_fixture = tmp_path / "native-intelligence-malformed.json"
    malformed_fixture.write_text("{malformed", encoding="utf-8")
    monkeypatch.setattr(native_executor, "_FIXTURE_PATH", malformed_fixture)
    malformed_fixture_manifest = native_intelligence_action_manifest(action)

    assert [
        case["missingReasons"]
        for case in (executor_case, contract_case, fixture_case)
    ] == [
        ["executor_registered"],
        ["contract_complete"],
        ["fixture_evidence_registered"],
    ]
    assert all(
        case["status"] == "blocked" and not case["runnable"]
        for case in (executor_case, contract_case, fixture_case)
    )
    assert gate_case["missingReasons"] == [
        "contract_complete",
        "gates_resolvable",
    ]
    assert removed_gate_case["missingReasons"] == ["contract_complete"]
    assert cross_action_case["missingReasons"] == [
        "contract_complete",
        "fixture_evidence_registered",
    ]
    assert wrong_action_case["missingReasons"] == ["fixture_evidence_registered"]
    assert malformed_resolver_case["missingReasons"] == ["gates_resolvable"]
    assert missing_reason_case["missingReasons"] == ["gates_resolvable"]
    assert missing_registry_contract["readiness"]["missingReasons"] == [
        "contract_complete"
    ]
    assert "fixture_evidence_registered" in (
        missing_fixture_manifest["readiness"]["missingReasons"]
    )
    assert "fixture_evidence_registered" in (
        malformed_fixture_manifest["readiness"]["missingReasons"]
    )


def test_readiness_predicate_exception_logs_action_and_predicate(
    monkeypatch,
    caplog,
):
    action = NATIVE_INTELLIGENCE_ACTION_BY_NAME["research"]
    manifest = native_intelligence_action_manifest(action)

    def fail_contract_check(*_args, **_kwargs):
        raise RuntimeError("injected readiness predicate failure")

    monkeypatch.setattr(
        native_executor,
        "_contract_complete",
        fail_contract_check,
    )
    with caplog.at_level("ERROR", logger=native_executor.__name__):
        readiness = certify_native_intelligence_action(action, manifest)

    assert readiness["status"] == "blocked"
    assert readiness["predicates"]["contract_complete"] is False
    record = next(
        item
        for item in caplog.records
        if item.getMessage() == "native intelligence readiness predicate failed"
    )
    assert record.action == "research"
    assert record.predicate == "contract_complete"
    assert record.exc_info is not None


@pytest.mark.asyncio
async def test_research_fixture_requires_explicit_offline_source_mode(
    client,
    db_session,
):
    project = _action_project("research")
    project["nodes"][0]["params"]["toolParams"] = {
        "fixtureId": "native-intelligence-offline-v1"
    }
    before = await _intelligence_row_counts(db_session)

    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": project,
            "runId": "run-native-implicit-fixture-rejected",
            "traceId": "trace-native-implicit-fixture-rejected",
        },
    )

    assert response.status_code == 202
    state = response.json()["data"]["nodeStates"][0]
    assert state["status"] == "blocked"
    assert state["blockReasons"][0]["code"] == "research_input_required"
    after = await _intelligence_row_counts(db_session)
    assert after[1:3] == before[1:3]
    assert after[4:] == before[4:]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    [
        "runtime_inputs",
        "runtime_outputs",
        "runtime_errors",
        "resource_gate",
        "event_contract",
        "provenance",
        "limits",
        "action",
        "action_binding",
        "mutates",
        "fixture",
        "gate_shape",
    ],
)
async def test_malformed_certification_shapes_fail_closed_in_api(
    client,
    monkeypatch,
    case,
):
    original_manifest = native_executor.native_intelligence_action_manifest

    def malformed_manifest(action):
        manifest = original_manifest(action)
        if action.name == "research":
            _malform_research_manifest(manifest, case)
            manifest["readiness"] = certify_native_intelligence_action(
                action,
                manifest,
            )
        return manifest

    monkeypatch.setattr(
        tool_capability_registry,
        "native_intelligence_action_manifest",
        malformed_manifest,
    )
    response = await client.get("/api/v1/workflows/tool-capabilities")
    assert response.status_code == 200
    tools = response.json()["data"]["tools"]
    research = next(
        item for item in tools if item["id"] == "tool.intelligence.native.research"
    )
    ontology = next(
        item for item in tools if item["id"] == "tool.intelligence.native.ontology"
    )
    assert research["status"] == "blocked"
    assert research["manifest"]["readiness"]["runnable"] is False
    assert research["manifest"]["readiness"]["missingReasons"]
    assert ontology["status"] == "runnable"


@pytest.mark.asyncio
async def test_runtime_contract_manifest_exception_fails_closed_in_api(
    client,
    monkeypatch,
):
    class BrokenRuntimeContract:
        status = "executable"

        def to_manifest(self):
            raise RuntimeError("injected manifest failure")

    monkeypatch.setitem(
        RUNTIME_IO_CONTRACTS,
        "workflow.native-intelligence.research",
        BrokenRuntimeContract(),
    )
    response = await client.get("/api/v1/workflows/tool-capabilities")
    assert response.status_code == 200
    tools = response.json()["data"]["tools"]
    research = next(
        item for item in tools if item["id"] == "tool.intelligence.native.research"
    )
    ontology = next(
        item for item in tools if item["id"] == "tool.intelligence.native.ontology"
    )
    assert research["status"] == "blocked"
    assert research["manifest"]["readiness"]["missingReasons"] == [
        "contract_complete"
    ]
    assert ontology["status"] == "runnable"


@pytest.mark.asyncio
async def test_native_capability_api_and_package_readiness_share_registry(client):
    tools_response = await client.get("/api/v1/workflows/tool-capabilities")
    tools = [
        item
        for item in tools_response.json()["data"]["tools"]
        if item["executor"]["mode"] == "native_intelligence"
    ]
    assert len(tools) == len(NATIVE_INTELLIGENCE_ACTIONS) == 29
    assert all(item["status"] == "runnable" for item in tools)
    assert all(item["manifest"]["readiness"]["runnable"] for item in tools)
    scenarios = [item["manifest"]["fixtureEvidence"]["scenario"] for item in tools]
    assert len({scenario["id"] for scenario in scenarios}) == 29
    assert {scenario["action"] for scenario in scenarios} == {
        action.name for action in NATIVE_INTELLIGENCE_ACTIONS
    }

    capabilities = (await client.get("/api/v1/workflows/capabilities")).json()["data"]
    package = next(
        item
        for item in capabilities["catalog"]
        if item["id"] == "package.intelligence.native-lifecycle"
    )
    assert package["status"] == "runnable"
    assert package["manifest"]["readiness"]["childCount"] == 18
    assert package["manifest"]["readiness"]["blockedChildren"] == []


def test_optional_action_readiness_does_not_change_lifecycle_package(monkeypatch):
    monkeypatch.delitem(_ACTION_HANDLERS, "simulation.status")
    projection = build_workflow_capabilities()
    package = next(
        item
        for item in projection.catalog
        if item.id == "package.intelligence.native-lifecycle"
    )
    optional = next(
        item
        for item in projection.resources
        if item.id
        == "resource.tool-capability.tool.intelligence.native.simulation.status"
    )
    assert optional.status == "blocked"
    assert package.status == "runnable"
    assert package.manifest["readiness"]["childCount"] == 18


@pytest.mark.asyncio
async def test_action_binding_contract_covers_observed_public_error(client):
    project = _action_project("ontology")
    compile_response = await client.post(
        "/api/v1/workflows/compile", json={"project": project}
    )
    assert compile_response.status_code == 200
    runtime = compile_response.json()["data"]["plan"]["runtime"]["nodes"][0]["runtime"]
    assert runtime["binding"]["binding_id"] == "workflow.native-intelligence.ontology"
    error_codes = {
        item["code"] for item in runtime["binding"]["contract"]["errors"]
    }
    assert {
        "research_artifact_missing",
        "intelligence_session_not_found",
        "intelligence_version_conflict",
        "intelligence_idempotency_conflict",
        "intelligence_artifact_not_found",
        "operation_in_progress",
        "intelligence_session_id_invalid",
        "intelligence_session_ref_invalid",
    } <= error_codes

    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": project,
            "runId": "run-native-ontology-no-session",
            "traceId": "trace-native-ontology-no-session",
        },
    )
    assert response.status_code == 202
    state = response.json()["data"]["nodeStates"][0]
    assert state["status"] == "blocked"
    assert state["blockReasons"][0]["code"] == "intelligence_session_not_found"
    assert state["blockReasons"][0]["code"] in error_codes

    invalid_session_project = _action_project("research")
    invalid_session_project["nodes"][0]["params"]["toolParams"] = {
        "intelligenceSessionRef": {"sessionId": "not-a-uuid"},
        "fixtureId": "native-intelligence-offline-v1",
        "sourceMode": "offline_fixture",
    }
    invalid_response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": invalid_session_project,
            "runId": "run-native-invalid-session-id",
            "traceId": "trace-native-invalid-session-id",
        },
    )
    assert invalid_response.status_code == 202
    invalid_state = invalid_response.json()["data"]["nodeStates"][0]
    assert invalid_state["blockReasons"][0]["code"] == "intelligence_session_ref_invalid"
    assert "badly formed" not in invalid_state["blockReasons"][0]["message"]

    raw_session_project = _action_project("research")
    raw_session_project["nodes"][0]["params"]["toolParams"] = {
        "sessionId": "not-a-uuid",
    }
    raw_compile = await client.post(
        "/api/v1/workflows/compile",
        json={"project": raw_session_project},
    )
    assert raw_compile.status_code == 200
    assert any(
        error["code"] == "forbidden_node_definition"
        for error in raw_compile.json()["data"]["errors"]
    )

    wrong_edge_project = _action_project("research")
    wrong_edge_project["nodes"].append(
        {
            "id": "normalize",
            "kind": "agent",
            "capability": "normalize",
            "params": {},
            "ui": {"catalogId": "intelligence.processing.normalize"},
        }
    )
    wrong_edge_project["edges"] = [
        {
            "id": "native-to-items",
            "source": "native-action",
            "target": "normalize",
            "sourcePort": "out",
            "targetPort": "in",
        }
    ]
    wrong_edge_compile = await client.post(
        "/api/v1/workflows/compile",
        json={"project": wrong_edge_project},
    )
    assert any(
        error["code"] == "incompatible_edge_ports"
        for error in wrong_edge_compile.json()["data"]["errors"]
    )


@pytest.mark.asyncio
async def test_typed_ref_resumes_across_runs_and_rejects_tampering_without_mutation(
    client,
    db_session,
):
    missing_session_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    missing_ref = {
        "schema": "intelligence-session-ref.v1",
        "sessionId": missing_session_id,
        "version": 0,
        "artifactRefs": [
            {
                "artifactId": "research_missing",
                "kind": "research",
                "contentHash": "0" * 64,
            }
        ],
    }
    empty_counts = await _intelligence_row_counts(db_session)
    missing_session = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(
                ["research"],
                first_params={"intelligenceSessionRef": missing_ref},
            ),
            "runId": "run-native-missing-explicit-ref",
            "traceId": "trace-native-missing-explicit-ref",
        },
    )
    missing_state = missing_session.json()["data"]["nodeStates"][0]
    assert missing_state["status"] == "blocked"
    assert missing_state["blockReasons"][0]["code"] == (
        "intelligence_session_not_found"
    )
    assert await db_session.get(IntelligenceSession, missing_session_id) is None
    assert await _intelligence_row_counts(db_session) == empty_counts

    prepare_actions = [
        "research",
        "ontology",
        "graph",
        "personas",
        "simulation.start",
        "simulation.run",
        "interviews.all",
        "interviews.run",
        "report.start",
        "report.run",
    ]
    prepared = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(prepare_actions),
            "runId": "run-native-prepare-report",
            "traceId": "trace-native-prepare-report",
        },
    )
    assert prepared.status_code == 202
    assert prepared.json()["data"]["status"] == "completed"
    prepared_events = (
        await client.get("/api/v1/workflows/runs/run-native-prepare-report/events")
    ).json()["data"]
    prepared_ref = next(
        event["details"]["sampleOutputs"][0]["intelligenceSessionRef"]
        for event in reversed(prepared_events)
        if event["eventType"] == "partial"
        and event["details"].get("executorMode") == "native_intelligence"
    )
    session_id = prepared_ref["sessionId"]
    aggregate = await db_session.get(IntelligenceSession, session_id)
    assert aggregate is not None
    version_before = aggregate.version
    counts_before_tamper = await _intelligence_row_counts(db_session)

    bad_hash_ref = deepcopy(prepared_ref)
    bad_hash_ref["artifactRefs"][0]["contentHash"] = "0" * 64
    bad_hash = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(
                ["report.read"],
                first_params={"intelligenceSessionRef": bad_hash_ref},
            ),
            "runId": "run-native-bad-ref-hash",
            "traceId": "trace-native-bad-ref-hash",
        },
    )
    assert bad_hash.json()["data"]["nodeStates"][0]["blockReasons"][0]["code"] == (
        "intelligence_artifact_ref_hash_mismatch"
    )
    await db_session.refresh(aggregate)
    assert aggregate.version == version_before
    assert await _intelligence_row_counts(db_session) == counts_before_tamper

    wrong_kind_ref = deepcopy(prepared_ref)
    report_ref = next(
        item for item in wrong_kind_ref["artifactRefs"] if item["kind"] == "report"
    )
    report_ref["kind"] = "graph"
    wrong_kind = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(
                ["report.read"],
                first_params={"intelligenceSessionRef": wrong_kind_ref},
            ),
            "runId": "run-native-wrong-ref-kind",
            "traceId": "trace-native-wrong-ref-kind",
        },
    )
    assert wrong_kind.json()["data"]["nodeStates"][0]["blockReasons"][0]["code"] == (
        "intelligence_artifact_ref_kind_mismatch"
    )
    await db_session.refresh(aggregate)
    assert aggregate.version == version_before
    assert await _intelligence_row_counts(db_session) == counts_before_tamper

    resumed = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(
                ["report.read", "report.ask", "report.answers", "close"],
                first_params={"intelligenceSessionRef": prepared_ref},
            ),
            "runId": "run-native-resume-report",
            "traceId": "trace-native-resume-report",
        },
    )
    assert resumed.status_code == 202
    assert resumed.json()["data"]["status"] == "completed"
    resumed_events = (
        await client.get("/api/v1/workflows/runs/run-native-resume-report/events")
    ).json()["data"]
    assert [
        event["details"]["sampleOutputs"][0]["action"]
        for event in resumed_events
        if event["eventType"] == "partial"
        and event["details"].get("executorMode") == "native_intelligence"
    ] == ["report.read", "report.ask", "report.answers", "close"]


@pytest.mark.parametrize(
    ("case", "expected_code"),
    (
        ("stale-version", "intelligence_version_conflict"),
        ("missing-artifact-refs", "intelligence_artifact_ref_invalid"),
        ("empty-artifact-refs", "research_artifact_missing"),
        ("missing-research", "research_artifact_missing"),
        ("wrong-session", "intelligence_artifact_not_found"),
        ("wrong-schema", "intelligence_session_ref_invalid"),
    ),
)
@pytest.mark.asyncio
async def test_explicit_ref_requires_current_version_and_action_artifacts_without_fallback(
    client,
    db_session,
    case,
    expected_code,
):
    async def prepare_ref(run_id, actions, *, first_params=None):
        response = await client.post(
            "/api/v1/workflows/runs",
            json={
                "project": _action_chain_project(
                    actions,
                    first_params=first_params,
                ),
                "runId": run_id,
                "traceId": f"trace-{run_id}",
            },
        )
        assert response.status_code == 202
        assert response.json()["data"]["status"] == "completed"
        events = (
            await client.get(f"/api/v1/workflows/runs/{run_id}/events")
        ).json()["data"]
        return next(
            event["details"]["sampleOutputs"][0]["intelligenceSessionRef"]
            for event in reversed(events)
            if event["eventType"] == "partial"
            and event["details"].get("executorMode") == "native_intelligence"
        )

    prepared_run_id = "run-expref-source"
    assert len(prepared_run_id) <= 36
    prepared_ref = await prepare_ref(
        prepared_run_id,
        ["research", "ontology"],
    )
    session_id = prepared_ref["sessionId"]
    aggregate = await db_session.get(IntelligenceSession, session_id)
    assert aggregate is not None
    version_before = aggregate.version

    session_ref = deepcopy(prepared_ref)
    if case == "stale-version":
        session_ref["version"] -= 1
        assert session_ref["version"] != version_before
    elif case == "missing-artifact-refs":
        session_ref.pop("artifactRefs")
        assert "artifactRefs" not in session_ref
    elif case == "empty-artifact-refs":
        session_ref["artifactRefs"] = []
        assert session_ref["artifactRefs"] == []
    elif case == "missing-research":
        session_ref["artifactRefs"] = [
            item
            for item in session_ref["artifactRefs"]
            if item["kind"] == "ontology"
        ]
        assert {item["kind"] for item in session_ref["artifactRefs"]} == {
            "ontology"
        }
    elif case == "wrong-session":
        other_run_id = "run-expref-other"
        assert len(other_run_id) <= 36
        other_ref = await prepare_ref(
            other_run_id,
            ["research"],
            first_params={"seed": 99},
        )
        assert other_ref["sessionId"] != session_id
        session_ref["artifactRefs"] = deepcopy(other_ref["artifactRefs"])
        assert session_ref["artifactRefs"]
    else:
        assert case == "wrong-schema"
        session_ref["schema"] = "intelligence-session-ref.v0"
        assert session_ref["schema"] != "intelligence-session-ref.v1"

    counts_before = await _intelligence_row_counts(db_session)
    failed_run_id = f"run-expref-{case}"
    assert len(failed_run_id) <= 36
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(
                ["ontology"],
                first_params={"intelligenceSessionRef": session_ref},
            ),
            "runId": failed_run_id,
            "traceId": f"trace-native-explicit-ref-{case}",
        },
    )
    assert response.status_code == 202
    node_state = response.json()["data"]["nodeStates"][0]
    assert node_state["status"] in {"blocked", "failed"}, case
    assert node_state["blockReasons"][0]["code"] == expected_code

    db_session.expire_all()
    aggregate = await db_session.get(IntelligenceSession, session_id)
    assert aggregate is not None
    assert aggregate.version == version_before
    assert await _intelligence_row_counts(db_session) == counts_before


@pytest.mark.parametrize("malformed_ref", (None, "not-a-ref", []))
@pytest.mark.asyncio
async def test_raw_malformed_explicit_ref_blocks_same_run_without_mutation(
    client,
    db_session,
    malformed_ref,
):
    prepared_run_id = "run-native-raw-ref-source"
    prepared = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(["research"]),
            "runId": prepared_run_id,
            "traceId": "trace-native-raw-ref-source",
        },
    )
    assert prepared.status_code == 202
    prepared_events = (
        await client.get(f"/api/v1/workflows/runs/{prepared_run_id}/events")
    ).json()["data"]
    prepared_ref = next(
        event["details"]["sampleOutputs"][0]["intelligenceSessionRef"]
        for event in reversed(prepared_events)
        if event["eventType"] == "partial"
        and event["details"].get("executorMode") == "native_intelligence"
    )
    aggregate = await db_session.get(
        IntelligenceSession,
        prepared_ref["sessionId"],
    )
    assert aggregate is not None
    version_before = aggregate.version

    run_id = f"run-native-raw-ref-{type(malformed_ref).__name__}"
    started = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _raw_ref_action_project(),
            "runId": run_id,
            "traceId": f"trace-{run_id}",
        },
    )
    assert started.status_code == 202
    counts_before = await _intelligence_row_counts(db_session)

    continued = await client.post(
        f"/api/v1/workflows/runs/{run_id}/source-outputs",
        json={
            "sourceOutputs": {
                "research": [
                    {"intelligenceSessionRef": prepared_ref},
                    {"intelligenceSessionRef": malformed_ref},
                ]
            }
        },
    )

    assert continued.status_code == 202
    assert continued.json()["data"]["errors"] == []
    assert any(
        state["nodeId"] == "ontology"
        for state in continued.json()["data"]["nodeStates"]
    ), continued.json()
    node_state = next(
        state
        for state in continued.json()["data"]["nodeStates"]
        if state["nodeId"] == "ontology"
    )
    assert node_state["status"] == "failed"
    assert node_state["blockReasons"][0]["code"] == (
        "intelligence_session_ref_invalid"
    )
    db_session.expire_all()
    aggregate = await db_session.get(
        IntelligenceSession,
        prepared_ref["sessionId"],
    )
    assert aggregate is not None
    assert aggregate.version == version_before
    assert await _intelligence_row_counts(db_session) == counts_before


def test_output_session_ref_compacts_capacity_and_retains_new_artifact():
    interview_refs = [
        {
            "artifactId": f"interview-{index:02d}",
            "kind": "interview",
            "contentHash": f"{index:064x}",
        }
        for index in range(50)
    ]
    old_report_refs = [
        {
            "artifactId": f"report-{index:02d}",
            "kind": "report",
            "contentHash": f"{index + 100:064x}",
        }
        for index in range(14)
    ]
    new_answer = {
        "artifactId": "answer-new",
        "kind": "report_answer",
        "contentHash": "f" * 64,
    }

    output = _output_session_ref(
        "00000000-0000-0000-0000-000000000001",
        7,
        {"artifactRefs": [*interview_refs, *old_report_refs]},
        {"artifacts": [new_answer]},
    )

    refs = output["artifactRefs"]
    assert len(refs) <= 64
    assert sum(ref["kind"] == "interview" for ref in refs) == 50
    assert sum(ref["kind"] == "report" for ref in refs) == 1
    assert refs[-1] == new_answer


@pytest.mark.asyncio
async def test_fifty_interviews_and_prerequisites_remain_closed_through_report_chain(
    client,
    db_session,
):
    async def output_ref(run_id):
        events = (
            await client.get(f"/api/v1/workflows/runs/{run_id}/events")
        ).json()["data"]
        return next(
            event["details"]["sampleOutputs"][0]["intelligenceSessionRef"]
            for event in reversed(events)
            if event["eventType"] == "partial"
            and event["details"].get("executorMode") == "native_intelligence"
        )

    prepare_run_id = "run-ref-capacity-prepare"
    prepared = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(
                [
                    "research",
                    "ontology",
                    "graph",
                    "personas",
                    "simulation.prepare",
                    "simulation.start",
                    "simulation.run",
                ]
            ),
            "runId": prepare_run_id,
            "traceId": "trace-ref-capacity-prepare",
        },
    )
    assert prepared.status_code == 202
    assert prepared.json()["data"]["status"] == "completed"
    prepared_ref = await output_ref(prepare_run_id)
    session_id = prepared_ref["sessionId"]
    artifact_ids_by_kind = {
        ref["kind"]: ref["artifactId"] for ref in prepared_ref["artifactRefs"]
    }
    interview_grounding = [
        artifact_ids_by_kind["persona"],
        artifact_ids_by_kind["graph"],
        artifact_ids_by_kind["simulation"],
    ]

    interviews = [
        InterviewArtifact(
            artifact_id=f"capacity-interview-{index:02d}",
            session_id=session_id,
            payload={
                "sequence": index,
                "personaArtifactId": artifact_ids_by_kind["persona"],
                "simulationArtifactId": artifact_ids_by_kind["simulation"],
                "simulated": True,
            },
            grounding_artifact_ids=interview_grounding,
            simulated=True,
            provenance=ArtifactProvenance(
                source="capacity-test",
                evidence_artifact_ids=interview_grounding,
            ),
            algorithm_version="capacity-test-v1",
            seed=index,
        )
        for index in range(50)
    ]
    store = IntelligenceStore(db_session)
    await store._append_artifacts(interviews)
    await commit_session(db_session)
    prepared_ref["artifactRefs"].extend(
        {
            "artifactId": artifact.artifact_id,
            "kind": artifact.kind.value,
            "contentHash": canonical_hash(artifact.model_dump(mode="json")),
        }
        for artifact in interviews
    )
    assert len(prepared_ref["artifactRefs"]) == 55

    start_run_id = "run-ref-capacity-report-start"
    started = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(
                ["report.start", "report.progress"],
                first_params={"intelligenceSessionRef": prepared_ref},
            ),
            "runId": start_run_id,
            "traceId": "trace-ref-capacity-report-start",
        },
    )
    assert started.status_code == 202
    assert started.json()["data"]["status"] == "completed", [
        state["blockReasons"] for state in started.json()["data"]["nodeStates"]
    ]
    reporting_ref = await output_ref(start_run_id)
    assert sum(
        ref["kind"] == "interview" for ref in reporting_ref["artifactRefs"]
    ) == 50
    finish_run_id = "run-ref-capacity-report-finish"
    aggregate = await db_session.get(IntelligenceSession, session_id)
    assert aggregate is not None
    aggregate.lease_owner = f"workflow:{finish_run_id}"
    await commit_session(db_session)

    legacy_reports = [
        ReportArtifact(
            artifact_id=f"capacity-report-{index:02d}",
            session_id=session_id,
            payload={"section": index, "simulated": True},
            simulated=True,
            provenance=ArtifactProvenance(source="capacity-test"),
            algorithm_version="capacity-test-v1",
            seed=100 + index,
        )
        for index in range(9)
    ]
    await store._append_artifacts(legacy_reports)
    await commit_session(db_session)
    reporting_ref["artifactRefs"].extend(
        {
            "artifactId": artifact.artifact_id,
            "kind": artifact.kind.value,
            "contentHash": canonical_hash(artifact.model_dump(mode="json")),
        }
        for artifact in legacy_reports
    )
    assert len(reporting_ref["artifactRefs"]) == 64

    finished = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(
                ["report.run", "report.ask", "report.answers"],
                first_params={"intelligenceSessionRef": reporting_ref},
            ),
            "runId": finish_run_id,
            "traceId": "trace-ref-capacity-report-finish",
        },
    )
    assert finished.status_code == 202
    assert finished.json()["data"]["status"] == "completed", [
        state["blockReasons"] for state in finished.json()["data"]["nodeStates"]
    ]
    finish_events = (
        await client.get(f"/api/v1/workflows/runs/{finish_run_id}/events")
    ).json()["data"]
    answer_artifact_id = next(
        event["details"]["sampleOutputs"][0]["result"]["artifacts"][0][
            "artifactId"
        ]
        for event in finish_events
        if event["eventType"] == "partial"
        and event["details"]["sampleOutputs"][0]["action"] == "report.ask"
    )
    final_ref = await output_ref(finish_run_id)
    assert len(final_ref["artifactRefs"]) <= 64
    assert sum(ref["kind"] == "interview" for ref in final_ref["artifactRefs"]) == 50
    assert any(
        ref["artifactId"] == answer_artifact_id
        for ref in final_ref["artifactRefs"]
    )

    accepted = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(
                ["report.read"],
                first_params={"intelligenceSessionRef": final_ref},
            ),
            "runId": "run-ref-capacity-next-entry",
            "traceId": "trace-ref-capacity-next-entry",
        },
    )
    assert accepted.status_code == 202
    assert accepted.json()["data"]["status"] == "completed"


@pytest.mark.parametrize(
    ("case", "expected_code"),
    (
        ("too-many-total", "intelligence_artifact_ref_invalid"),
        ("too-many-interviews", "intelligence_artifact_ref_invalid"),
        ("duplicate", "intelligence_artifact_ref_invalid"),
        ("foreign", "intelligence_artifact_not_found"),
        ("missing", "intelligence_artifact_not_found"),
        ("hash-mismatch", "intelligence_artifact_ref_hash_mismatch"),
    ),
)
@pytest.mark.asyncio
async def test_explicit_artifact_refs_are_bounded_unique_and_bulk_loaded(
    client,
    db_session,
    case,
    expected_code,
):
    async def prepare_ref(run_id, *, seed=0):
        response = await client.post(
            "/api/v1/workflows/runs",
            json={
                "project": _action_chain_project(
                    ["research", "ontology"],
                    first_params={"seed": seed},
                ),
                "runId": run_id,
                "traceId": f"trace-{run_id}",
            },
        )
        assert response.status_code == 202
        events = (
            await client.get(f"/api/v1/workflows/runs/{run_id}/events")
        ).json()["data"]
        return next(
            event["details"]["sampleOutputs"][0]["intelligenceSessionRef"]
            for event in reversed(events)
            if event["eventType"] == "partial"
            and event["details"].get("executorMode") == "native_intelligence"
        )

    prepared_ref = await prepare_ref("run-native-bounded-ref-source")
    session_id = prepared_ref["sessionId"]
    aggregate = await db_session.get(IntelligenceSession, session_id)
    assert aggregate is not None
    version_before = aggregate.version
    research_ref = next(
        item for item in prepared_ref["artifactRefs"] if item["kind"] == "research"
    )
    session_ref = deepcopy(prepared_ref)

    if case == "too-many-total":
        session_ref["artifactRefs"] = [
            {
                "artifactId": f"missing-artifact-{index}",
                "kind": "research",
                "contentHash": "0" * 64,
            }
            for index in range(65)
        ]
    elif case == "too-many-interviews":
        session_ref["artifactRefs"] = [
            {
                "artifactId": f"missing-interview-{index}",
                "kind": "interview",
                "contentHash": "0" * 64,
            }
            for index in range(51)
        ]
    elif case == "duplicate":
        session_ref["artifactRefs"] = [deepcopy(research_ref), deepcopy(research_ref)]
    elif case == "foreign":
        other_ref = await prepare_ref(
            "run-native-bounded-ref-foreign",
            seed=99,
        )
        assert other_ref["sessionId"] != session_id
        session_ref["artifactRefs"] = deepcopy(other_ref["artifactRefs"])
    elif case == "missing":
        session_ref["artifactRefs"] = [
            {
                "artifactId": "missing-artifact",
                "kind": "research",
                "contentHash": "0" * 64,
            }
        ]
    else:
        assert case == "hash-mismatch"
        session_ref["artifactRefs"] = [deepcopy(research_ref)]
        session_ref["artifactRefs"][0]["contentHash"] = "0" * 64

    counts_before = await _intelligence_row_counts(db_session)
    artifact_queries = []

    def capture_artifact_query(
        _connection,
        _cursor,
        statement,
        _parameters,
        _context,
        _executemany,
    ):
        normalized = statement.lower()
        if (
            " from intelligence_artifacts" in normalized
            or " from intelligence_artifact_references" in normalized
        ):
            artifact_queries.append(statement)

    engine = db_session.bind
    assert engine is not None
    failed_run_id = f"run-bref-{hashlib.sha256(case.encode()).hexdigest()[:8]}"
    assert len(failed_run_id) <= 36
    event.listen(engine.sync_engine, "before_cursor_execute", capture_artifact_query)
    try:
        response = await client.post(
            "/api/v1/workflows/runs",
            json={
                "project": _action_chain_project(
                    ["ontology"],
                    first_params={"intelligenceSessionRef": session_ref},
                ),
                    "runId": failed_run_id,
                "traceId": f"trace-native-bounded-ref-{case}",
            },
        )
    finally:
        event.remove(
            engine.sync_engine,
            "before_cursor_execute",
            capture_artifact_query,
        )

    assert response.status_code == 202
    node_state = response.json()["data"]["nodeStates"][0]
    assert node_state["status"] in {"blocked", "failed"}
    assert node_state["blockReasons"][0]["code"] == expected_code
    assert len(artifact_queries) <= 2
    if case in {"too-many-total", "too-many-interviews", "duplicate"}:
        assert artifact_queries == []

    db_session.expire_all()
    aggregate = await db_session.get(IntelligenceSession, session_id)
    assert aggregate is not None
    assert aggregate.version == version_before
    assert await _intelligence_row_counts(db_session) == counts_before


@pytest.mark.asyncio
async def test_native_command_retries_one_transient_sqlite_transaction(
    client,
    db_session,
    monkeypatch,
):
    prepared_run_id = "run-native-retry-once-source"
    prepared = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(["research"]),
            "runId": prepared_run_id,
            "traceId": "trace-native-retry-once-source",
        },
    )
    assert prepared.status_code == 202
    prepared_events = (
        await client.get(f"/api/v1/workflows/runs/{prepared_run_id}/events")
    ).json()["data"]
    prepared_ref = next(
        event["details"]["sampleOutputs"][0]["intelligenceSessionRef"]
        for event in reversed(prepared_events)
        if event["eventType"] == "partial"
        and event["details"].get("executorMode") == "native_intelligence"
    )
    aggregate = await db_session.get(
        IntelligenceSession,
        prepared_ref["sessionId"],
    )
    assert aggregate is not None
    version_before = aggregate.version
    counts_before = await _intelligence_row_counts(db_session)

    original_fault = IntelligenceStore._fault
    failed_once = False
    attempted_sessions = []

    def inject_transient_lock(self, point):
        nonlocal failed_once
        if point == "after_cas":
            attempted_sessions.append(id(self.session))
            if not failed_once:
                failed_once = True
                raise OperationalError(
                    "UPDATE intelligence_sessions",
                    {},
                    sqlite3.OperationalError("database is locked"),
                )
        return original_fault(self, point)

    monkeypatch.setattr(IntelligenceStore, "_fault", inject_transient_lock)
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(
                ["ontology"],
                first_params={"intelligenceSessionRef": prepared_ref},
            ),
            "runId": "run-native-retry-once",
            "traceId": "trace-native-retry-once",
        },
    )

    assert response.status_code == 202
    assert response.json()["data"]["status"] == "completed"
    assert len(attempted_sessions) == 2
    assert len(set(attempted_sessions)) == 2
    db_session.expire_all()
    aggregate = await db_session.get(
        IntelligenceSession,
        prepared_ref["sessionId"],
    )
    assert aggregate is not None
    assert aggregate.version == version_before + 1
    counts_after = await _intelligence_row_counts(db_session)
    assert tuple(after - before for after, before in zip(counts_after, counts_before)) == (
        0,
        1,
        1,
        1,
        1,
        1,
    )


@pytest.mark.asyncio
async def test_native_command_exhausts_transient_retries_without_half_commit(
    client,
    db_session,
    monkeypatch,
):
    prepared_run_id = "run-native-retry-exhausted-source"
    prepared = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(["research"]),
            "runId": prepared_run_id,
            "traceId": "trace-native-retry-exhausted-source",
        },
    )
    assert prepared.status_code == 202
    prepared_events = (
        await client.get(f"/api/v1/workflows/runs/{prepared_run_id}/events")
    ).json()["data"]
    prepared_ref = next(
        event["details"]["sampleOutputs"][0]["intelligenceSessionRef"]
        for event in reversed(prepared_events)
        if event["eventType"] == "partial"
        and event["details"].get("executorMode") == "native_intelligence"
    )
    aggregate = await db_session.get(IntelligenceSession, prepared_ref["sessionId"])
    assert aggregate is not None
    version_before = aggregate.version
    counts_before = await _intelligence_row_counts(db_session)
    attempted_sessions = []

    def inject_transient_lock(self, point):
        if point == "after_cas":
            attempted_sessions.append(self.session)
            raise OperationalError(
                "UPDATE intelligence_sessions",
                {},
                sqlite3.OperationalError("database is locked"),
            )

    monkeypatch.setattr(IntelligenceStore, "_fault", inject_transient_lock)
    failed_run_id = "run-native-retry-exhausted"
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(
                ["ontology"],
                first_params={"intelligenceSessionRef": prepared_ref},
            ),
            "runId": failed_run_id,
            "traceId": "trace-native-retry-exhausted",
        },
    )

    assert response.status_code == 202
    node_state = response.json()["data"]["nodeStates"][0]
    assert node_state["status"] == "failed"
    assert node_state["blockReasons"][0]["code"] == "intelligence_store_error"
    assert (
        node_state["blockReasons"][0]["message"]
        == "intelligence_transaction_retry_exhausted"
    )
    assert len(attempted_sessions) == 3
    assert len({id(session) for session in attempted_sessions}) == 3
    failed_events = (
        await client.get(f"/api/v1/workflows/runs/{failed_run_id}/events")
    ).json()["data"]
    assert any(
        event["eventType"] == "failed"
        and event["message"] == "intelligence_transaction_retry_exhausted"
        for event in failed_events
    )

    db_session.expire_all()
    aggregate = await db_session.get(IntelligenceSession, prepared_ref["sessionId"])
    assert aggregate is not None
    assert aggregate.version == version_before
    assert await _intelligence_row_counts(db_session) == counts_before


@pytest.mark.asyncio
async def test_native_commit_retry_publishes_only_committed_workflow_visibility(
    client,
    db_session,
    monkeypatch,
):
    stream = "test.native-intelligence.commit-retry"
    monkeypatch.setenv("WORKFLOW_EVENT_MIRROR_BACKEND", "memory")
    monkeypatch.setenv("WORKFLOW_EVENT_MIRROR_STREAM", stream)
    reset_memory_workflow_event_mirror()
    prepared_run_id = "run-native-commit-retry-source"
    prepared = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(["research"]),
            "runId": prepared_run_id,
            "traceId": "trace-native-commit-retry-source",
        },
    )
    assert prepared.status_code == 202
    await commit_session(db_session)
    prepared_events = (
        await client.get(f"/api/v1/workflows/runs/{prepared_run_id}/events")
    ).json()["data"]
    prepared_ref = next(
        event["details"]["sampleOutputs"][0]["intelligenceSessionRef"]
        for event in reversed(prepared_events)
        if event["eventType"] == "partial"
        and event["details"].get("executorMode") == "native_intelligence"
    )
    reset_memory_workflow_event_mirror()

    original_commit = intelligence_store_module.commit_session
    commit_attempts = 0
    cleanup_attempts = 0

    async def fail_first_commit(session):
        nonlocal commit_attempts
        commit_attempts += 1
        if commit_attempts == 1:
            raise OperationalError(
                "COMMIT",
                {},
                sqlite3.OperationalError("database is locked"),
            )
        await original_commit(session)

    async def fail_rollback_cleanup(_session):
        nonlocal cleanup_attempts
        cleanup_attempts += 1
        raise RuntimeError("injected rollback cleanup failure")

    monkeypatch.setattr(
        intelligence_store_module,
        "commit_session",
        fail_first_commit,
        raising=False,
    )
    monkeypatch.setattr(
        database_module,
        "rollback_session",
        fail_rollback_cleanup,
    )
    run_id = "run-native-commit-retry"
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(
                ["ontology"],
                first_params={"intelligenceSessionRef": prepared_ref},
            ),
            "runId": run_id,
            "traceId": "trace-native-commit-retry",
        },
    )
    assert response.status_code == 202
    assert response.json()["data"]["status"] == "completed"
    await commit_session(db_session)

    persisted = (
        await db_session.scalars(
            select(WorkflowRunEvent)
            .where(WorkflowRunEvent.run_id == run_id)
            .order_by(WorkflowRunEvent.sequence)
        )
    ).all()
    mirrored = await list_workflow_event_mirror_records(
        run_id,
        backend="memory",
        stream=stream,
    )
    assert commit_attempts == 2
    assert cleanup_attempts == 1
    assert [record.event_id for record in mirrored] == [
        row.event_id for row in persisted
    ]
    assert len({record.event_id for record in mirrored}) == len(mirrored)
    cached = _RUNS.get(run_id)
    assert cached is not None
    assert [event.id for event in cached.events] == [
        row.event_id for row in persisted
    ]


@pytest.mark.parametrize(
    ("error_type", "primary_message", "expected_code"),
    (
        (ValueError, "domain primary value", "domain primary value"),
        (
            IntelligenceStoreError,
            "domain primary store",
            "intelligence_store_error",
        ),
    ),
)
@pytest.mark.asyncio
async def test_tracer_preserves_domain_error_when_rollback_cleanup_fails(
    client,
    db_session,
    monkeypatch,
    caplog,
    error_type,
    primary_message,
    expected_code,
):
    prepared_run_id = f"run-rb-prep-{error_type.__name__[:8].lower()}"
    prepared = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(["research"]),
            "runId": prepared_run_id,
            "traceId": f"trace-{prepared_run_id}",
        },
    )
    assert prepared.status_code == 202
    prepared_events = (
        await client.get(f"/api/v1/workflows/runs/{prepared_run_id}/events")
    ).json()["data"]
    prepared_ref = next(
        event["details"]["sampleOutputs"][0]["intelligenceSessionRef"]
        for event in reversed(prepared_events)
        if event["eventType"] == "partial"
        and event["details"].get("executorMode") == "native_intelligence"
    )

    async def raise_domain_error(*_args):
        raise error_type(primary_message)

    cleanup_attempts = 0
    callbacks_cleared_before_cleanup = False

    async def fail_rollback_cleanup():
        nonlocal callbacks_cleared_before_cleanup, cleanup_attempts
        cleanup_attempts += 1
        callbacks_cleared_before_cleanup = not db_session.info.get(
            "opencli_after_commit_callbacks"
        )
        raise ValueError("rollback cleanup failed")

    monkeypatch.setitem(_ACTION_HANDLERS, "ontology", raise_domain_error)
    monkeypatch.setattr(db_session, "rollback", fail_rollback_cleanup)

    failed_run_id = f"run-rb-fail-{error_type.__name__[:8].lower()}"
    with caplog.at_level(logging.ERROR, logger="backend.database"):
        failed = await client.post(
            "/api/v1/workflows/runs",
            json={
                "project": _action_chain_project(
                    ["ontology"],
                    first_params={"intelligenceSessionRef": prepared_ref},
                ),
                "runId": failed_run_id,
                "traceId": f"trace-{failed_run_id}",
            },
        )

    assert failed.status_code == 202
    node_state = failed.json()["data"]["nodeStates"][0]
    assert node_state["status"] == "failed"
    assert node_state["blockReasons"][0] == {
        "code": expected_code,
        "message": primary_message,
        "source": "native_intelligence",
        "details": {"exceptionType": error_type.__name__},
    }
    await commit_session(db_session)
    failed_events = (
        await client.get(f"/api/v1/workflows/runs/{failed_run_id}/events")
    ).json()["data"]
    assert any(
        event["eventType"] == "failed" and event["message"] == primary_message
        for event in failed_events
    )
    assert cleanup_attempts == 1
    assert callbacks_cleared_before_cleanup
    assert not db_session.info.get("opencli_after_commit_callbacks")
    assert any(
        record.name == "backend.database"
        and record.message
        == "Database rollback cleanup failed; preserving primary exception"
        for record in caplog.records
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(WorkflowRunEvent)
            .where(WorkflowRunEvent.run_id == failed_run_id)
        )
        or 0
    ) == len(failed_events)


@pytest.mark.parametrize(
    "fault_point",
    (
        "after_cas",
        "after_artifact_append",
        "after_transition_append",
        "after_workflow_event_append",
        "after_outbox_append",
    ),
)
@pytest.mark.asyncio
async def test_tracer_rolls_back_failed_native_command_before_persisting_failure_event(
    client,
    db_session,
    monkeypatch,
    fault_point,
):
    stream = f"test.native-intelligence.atomicity.{fault_point}"
    monkeypatch.setenv("WORKFLOW_EVENT_MIRROR_BACKEND", "memory")
    monkeypatch.setenv("WORKFLOW_EVENT_MIRROR_STREAM", stream)
    reset_memory_workflow_event_mirror()
    case_id = hashlib.sha256(fault_point.encode()).hexdigest()[:8]
    prepared_run_id = f"run-atom-prep-{case_id}"
    assert len(prepared_run_id) <= 36
    prepared = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(["research"]),
            "runId": prepared_run_id,
            "traceId": f"trace-native-atomicity-prepare-{fault_point}",
        },
    )
    assert prepared.status_code == 202
    await commit_session(db_session)
    reset_memory_workflow_event_mirror()
    prepared_events = (
        await client.get(f"/api/v1/workflows/runs/{prepared_run_id}/events")
    ).json()["data"]
    prepared_ref = next(
        event["details"]["sampleOutputs"][0]["intelligenceSessionRef"]
        for event in reversed(prepared_events)
        if event["eventType"] == "partial"
        and event["details"].get("executorMode") == "native_intelligence"
    )
    aggregate = await db_session.get(IntelligenceSession, prepared_ref["sessionId"])
    assert aggregate is not None
    version_before = aggregate.version
    counts_before = await _intelligence_row_counts(db_session)

    original_fault = IntelligenceStore._fault

    def inject_fault(self, point):
        if point == fault_point:
            raise IntelligenceStoreError(f"injected_{fault_point}")
        return original_fault(self, point)

    monkeypatch.setattr(IntelligenceStore, "_fault", inject_fault)
    failed_run_id = f"run-atom-fail-{case_id}"
    assert len(failed_run_id) <= 36
    failed = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _action_chain_project(
                ["ontology"],
                first_params={"intelligenceSessionRef": prepared_ref},
            ),
            "runId": failed_run_id,
            "traceId": f"trace-native-atomicity-failed-{fault_point}",
        },
    )

    assert failed.status_code == 202
    node_state = failed.json()["data"]["nodeStates"][0]
    assert node_state["status"] == "failed"
    assert node_state["blockReasons"][0]["code"] == "intelligence_store_error"
    failed_events = (
        await client.get(f"/api/v1/workflows/runs/{failed_run_id}/events")
    ).json()["data"]
    assert any(
        event["eventType"] == "failed"
        and event["message"] == f"injected_{fault_point}"
        for event in failed_events
    )
    await commit_session(db_session)
    persisted_events = (
        await db_session.scalars(
            select(WorkflowRunEvent)
            .where(WorkflowRunEvent.run_id == failed_run_id)
            .order_by(WorkflowRunEvent.sequence)
        )
    ).all()
    mirrored_events = await list_workflow_event_mirror_records(
        failed_run_id,
        backend="memory",
        stream=stream,
    )
    assert [record.event_id for record in mirrored_events] == [
        row.event_id for row in persisted_events
    ]
    cached = _RUNS.get(failed_run_id)
    assert cached is not None
    assert [event.id for event in cached.events] == [
        row.event_id for row in persisted_events
    ]

    db_session.expire_all()
    aggregate = await db_session.get(IntelligenceSession, prepared_ref["sessionId"])
    assert aggregate is not None
    assert aggregate.version == version_before
    assert await _intelligence_row_counts(db_session) == counts_before


@pytest.mark.asyncio
async def test_registered_offline_hda_runs_full_lifecycle_with_durable_trace(
    client,
    db_session,
):
    run_id = "run-native-intelligence-lifecycle"
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _project(),
            "runId": run_id,
            "traceId": "trace-native-intelligence-lifecycle",
        },
    )
    assert response.status_code == 202, response.text
    projection = response.json()["data"]
    assert projection["status"] == "completed", [
        (item["nodeId"], item["status"], item["blockReasons"])
        for item in projection["nodeStates"]
        if item["status"] != "completed"
    ]
    completed_node_ids = {
        item["nodeId"] for item in projection["nodeStates"] if item["status"] == "completed"
    }
    assert {
        "native-lifecycle::collection-source",
        "native-lifecycle::collection-normalize",
        "native-lifecycle::collection-output",
        "native-lifecycle::research",
    } <= completed_node_ids

    trace_response = await client.get(f"/api/v1/workflows/runs/{run_id}/trace")
    assert trace_response.status_code == 200
    trace = trace_response.json()["data"]
    events = trace["events"]
    transitions = [
        event
        for event in events
        if event["details"].get("schemaVersion")
        == "intelligence.workflow-projection.v1"
    ]
    assert transitions
    commands = [event["details"]["command"] for event in transitions]
    assert commands[0] == "research"
    assert "build_ontology" in commands
    assert "build_graph" in commands
    assert "simulation_complete" in commands
    assert "interview_complete" in commands
    assert "report_complete" in commands
    assert "ask_report" in commands
    assert commands[-1] == "close"
    assert transitions[-1]["details"]["domainState"] == "closed"

    completed_calls = [
        event
        for event in events
        if event["eventType"] == "tool_call_completed"
        and event["details"].get("executorMode") == "native_intelligence"
    ]
    assert len(completed_calls) == 18
    fixture_path = (
        Path(__file__).parents[2]
        / "backend"
        / "workflow"
        / "fixtures"
        / "native_intelligence_offline.json"
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    native_partials = [
        event
        for event in events
        if event["eventType"] == "partial"
        and event["details"].get("executorMode") == "native_intelligence"
    ]
    action_transcript = [
        event["details"]["sampleOutputs"][0]["action"] for event in native_partials
    ]
    assert action_transcript == fixture["expected"]["actionTranscript"]
    artifact_kinds = {
        artifact["kind"]
        for event in native_partials
        for artifact in (
            event["details"]["sampleOutputs"][0]["result"].get("artifacts", [])
            if isinstance(event["details"]["sampleOutputs"][0].get("result"), dict)
            else []
        )
    }
    assert artifact_kinds == set(fixture["expected"]["artifactKinds"])
    artifact_simulation_flags = {
        artifact["kind"]: artifact["simulated"]
        for event in native_partials
        for artifact in (
            event["details"]["sampleOutputs"][0]["result"].get("artifacts", [])
            if isinstance(event["details"]["sampleOutputs"][0].get("result"), dict)
            else []
        )
    }
    assert artifact_simulation_flags == {
        kind.value: simulated
        for kind, simulated in ARTIFACT_SIMULATION_EXPECTATIONS.items()
    }
    research_manifest = next(
        tool
        for tool in (
            await client.get("/api/v1/workflows/tool-capabilities")
        ).json()["data"]["tools"]
        if tool["id"] == "tool.intelligence.native.research"
    )["manifest"]
    assert research_manifest["fixtureEvidence"]["transcriptHash"] == hashlib.sha256(
        fixture_path.read_bytes()
    ).hexdigest()
    assert research_manifest["fixtureEvidence"]["expectedActionTranscript"] == action_transcript
    research_row = await db_session.scalar(
        select(IntelligenceArtifact).where(IntelligenceArtifact.kind == "research")
    )
    assert research_row is not None
    assert research_row.payload["inputLineage"]
    lineage_node_ids = {
        entry["nodeId"]
        for item in research_row.payload["inputLineage"]
        for entry in item["workflowLineage"]
    }
    assert {
        "native-lifecycle::collection-source",
        "native-lifecycle::collection-normalize",
        "native-lifecycle::collection-output",
    } <= lineage_node_ids

    report_call = next(
        event
        for event in events
        if event["nodeId"].endswith("report-run") and event["eventType"] == "partial"
    )
    sample = report_call["details"]["sampleOutputs"][0]
    assert sample["action"] == "report.run"
    assert sample["state"] == "reported"
    assert sample["provenance"]["credentialFree"] is True

    details_by_action = {
        event["details"]["sampleOutputs"][0]["action"]:
        event["details"]["sampleOutputs"][0]["result"]
        for event in native_partials
    }
    assert details_by_action["simulation.timeline"]
    assert details_by_action["simulation.stats"]
    assert details_by_action["interviews.history"]
    assert details_by_action["report.progress"]
    assert details_by_action["report.read"]["payload"]["sections"]
    answer_artifact = details_by_action["report.ask"]["artifacts"][0]
    answer = answer_artifact["payload"]
    assert answer["question"]
    assert answer["answer"]
    assert answer_artifact["groundingArtifactIds"]
    assert details_by_action["report.answers"][0]["payload"]["answer"] == answer["answer"]

    event_response = await client.get(f"/api/v1/workflows/runs/{run_id}/events")
    assert event_response.json()["data"] == events


@pytest.mark.asyncio
async def test_editor_added_native_package_materializes_compiles_and_runs(client):
    project = _editor_added_project()

    compile_response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": project},
    )
    assert compile_response.status_code == 200, compile_response.text
    compiled = compile_response.json()["data"]
    assert compiled["valid"] is True
    assert len(compiled["plan"]["runtime"]["nodes"]) == 24
    assert all(
        error["code"] != "invalid_parameter_binding"
        for error in compiled["errors"]
    )

    run_id = "run-editor-added-native-intelligence"
    run_response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": project,
            "runId": run_id,
            "traceId": "trace-editor-added-native-intelligence",
        },
    )
    assert run_response.status_code == 202, run_response.text
    assert run_response.json()["data"]["status"] == "completed"

    trace = (
        await client.get(f"/api/v1/workflows/runs/{run_id}/trace")
    ).json()["data"]
    completed_calls = [
        event
        for event in trace["events"]
        if event["eventType"] == "tool_call_completed"
        and event["details"].get("executorMode") == "native_intelligence"
    ]
    assert len(completed_calls) == 18


@pytest.mark.asyncio
async def test_registered_offline_hda_rejects_external_network_and_credentials(
    client,
    monkeypatch,
):
    credential_key = os.environ.get(crypto.ENV_KEY)
    assert credential_key
    external_env_names = {
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "DEEPSEEK_API_KEY",
        "MISTRAL_API_KEY",
        "COHERE_API_KEY",
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_ENDPOINT",
        "LLM_API_KEY",
        "LLM_BASE_URL",
        "OLLAMA_BASE_URL",
        "VLLM_BASE_URL",
        "JOYAI_VL_URL",
        "JOYAI_VL_API_KEY",
        "REDIS_URL",
        "ODP_REDIS_URL",
        "WORKFLOW_EVENT_MIRROR_REDIS_URL",
        "DATABASE_URL",
        "ODP_DATABASE_URL",
        "POSTGRES_HOST",
        "POSTGRES_PORT",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_DB",
        "PGHOST",
        "PGPORT",
        "PGUSER",
        "PGPASSWORD",
        "PGDATABASE",
        "MIROFISH_URL",
        "MIROFISH_ALLOW_ENDPOINT_OVERRIDE",
        "LAST30DAYS_ENGINE_PATH",
        "LAST30DAYS_HOME",
        "LAST30DAYS_PYTHON",
        "BROWSER_ACT_API_KEY",
    }
    external_env_markers = (
        "OPENAI",
        "ANTHROPIC",
        "GEMINI",
        "DEEPSEEK",
        "MISTRAL",
        "COHERE",
        "AZURE",
        "LLM",
        "OLLAMA",
        "VLLM",
        "JOYAI",
        "REDIS",
        "POSTGRES",
        "PGHOST",
        "PGPORT",
        "PGUSER",
        "PGPASSWORD",
        "PGDATABASE",
        "DATABASE_URL",
        "MIROFISH",
        "LAST30DAYS",
        "BROWSER_ACT",
    )
    for name in external_env_names | set(os.environ):
        if name == crypto.ENV_KEY:
            continue
        upper_name = name.upper()
        if upper_name.endswith("_API_KEY") or any(
            marker in upper_name for marker in external_env_markers
        ):
            monkeypatch.setenv(name, "")
    assert os.environ.get(crypto.ENV_KEY) == credential_key

    network_attempts: list[str] = []

    def reject_network(kind: str):
        def reject(*args, **kwargs):
            network_attempts.append(kind)
            raise AssertionError(f"offline HDA attempted external network via {kind}")

        return reject

    original_async_send = httpx.AsyncClient.send

    async def guarded_async_send(self, request, *args, **kwargs):
        if isinstance(self._transport, httpx.ASGITransport):
            return await original_async_send(self, request, *args, **kwargs)
        network_attempts.append("httpx.AsyncClient")
        raise AssertionError(
            "offline HDA attempted external network via httpx.AsyncClient"
        )

    monkeypatch.setattr(httpx.AsyncClient, "send", guarded_async_send)
    monkeypatch.setattr(httpx.Client, "send", reject_network("httpx.Client"))
    monkeypatch.setattr(
        requests.sessions.Session,
        "request",
        reject_network("requests"),
    )
    monkeypatch.setattr(urllib.request, "urlopen", reject_network("urllib"))
    monkeypatch.setattr(socket, "create_connection", reject_network("socket"))
    monkeypatch.setattr(socket, "getaddrinfo", reject_network("dns"))

    run_id = "run-native-offline-isolation"
    assert len(run_id) <= 36
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _project(),
            "runId": run_id,
            "traceId": "trace-native-intelligence-offline-isolation",
        },
    )
    assert response.status_code == 202, response.text
    assert response.json()["data"]["status"] == "completed"

    trace = (
        await client.get(f"/api/v1/workflows/runs/{run_id}/trace")
    ).json()["data"]
    native_partials = [
        event
        for event in trace["events"]
        if event["eventType"] == "partial"
        and event["details"].get("executorMode") == "native_intelligence"
    ]
    action_transcript = [
        event["details"]["sampleOutputs"][0]["action"] for event in native_partials
    ]
    assert len(action_transcript) == 18
    assert action_transcript[-1] == "close"
    assert native_partials[-1]["details"]["sampleOutputs"][0]["state"] == "closed"
    assert network_attempts == []
