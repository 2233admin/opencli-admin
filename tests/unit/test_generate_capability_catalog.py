from __future__ import annotations

import copy
import hashlib
import importlib
import json
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
GENERATOR_MODULE = "scripts.generate_capability_catalog"
REAL_MATRIX_PATH = REPO_ROOT / "docs" / "backend-capability-exposure-matrix.yaml"
REAL_OUTPUT_PATH = (
    REPO_ROOT / "frontend" / "lib" / "plugins" / "generated-capability-catalog.json"
)
SECRET_CANARY = "opencli-capability-secret-canary-9f8e7d6c"
PUBLIC_API = {"validate_matrix", "build_catalog", "serialize_catalog"}


def _generator() -> ModuleType:
    try:
        module = importlib.import_module(GENERATOR_MODULE)
    except ModuleNotFoundError as exc:
        pytest.fail(
            "missing scripts.generate_capability_catalog; implement the A1 generator "
            "with validate_matrix(), build_catalog(), serialize_catalog(), and a "
            "python -m scripts.generate_capability_catalog CLI",
            pytrace=False,
        )
        raise AssertionError from exc

    missing = sorted(name for name in PUBLIC_API if not callable(getattr(module, name, None)))
    assert not missing, f"generator is missing public callables: {missing}"
    return module


def _valid_matrix() -> dict:
    return {
        "version": 1,
        "source": "backend.main.app.openapi",
        "openapi_operation_count": 1,
        "allowed_dispositions": ["operator_ui"],
        "operations": [
            {
                "method": "GET",
                "path": "/api/v1/example",
                "operation_id": "get_example",
                "disposition": "operator_ui",
                "frontend_route": "/plugins/example",
                "wrapper": "getExample",
                "decision": "Expose through the plugin provider detail.",
                "target_epic": "Epic 8",
                "capability_id": "provider.example",
            }
        ],
        "unreferenced_wrappers": [],
        "capability_groups": [
            {
                "capability_id": "provider.example",
                "label": "示例 Provider",
                "projection": "plugin_provider",
                "provider_key": "opencli-admin/example",
                "provider_aliases": ["legacy/example"],
                "primary_category": "datasource",
                "plugin_types": ["datasource", "tool"],
                "distribution": "builtin",
                "lifecycle": "active",
                "readiness_sources": {
                    "required": ["backend_plugin_catalog", "opencli_registry"],
                    "optional": ["workflow_capabilities"],
                },
                "target_route": "/studio",
                "configuration_route": "/plugins/example",
                "wrapper_names": ["getExample"],
                "workflow_node_ids": ["intelligence.source.opencli-slot"],
                "owner": "Epic 8",
            }
        ],
    }


EXPECTED_CATALOG = {
    "capabilityIds": ["provider.example"],
    "providers": [
        {
            "capabilityId": "provider.example",
            "configurationRoute": "/plugins/example",
            "distribution": "builtin",
            "label": "示例 Provider",
            "lifecycle": "active",
            "operationIds": ["get_example"],
            "owner": "Epic 8",
            "pluginTypes": ["datasource", "tool"],
            "primaryCategory": "datasource",
            "projection": "plugin_provider",
            "providerAliases": ["legacy/example"],
            "providerKey": "opencli-admin/example",
            "readinessSources": {
                "optional": ["workflow_capabilities"],
                "required": ["backend_plugin_catalog", "opencli_registry"],
            },
            "targetRoute": "/studio",
            "workflowNodeIds": ["intelligence.source.opencli-slot"],
            "wrapperNames": ["getExample"],
        }
    ],
    "version": 1,
}


def _expected_bytes() -> bytes:
    return (
        json.dumps(EXPECTED_CATALOG, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def _run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", GENERATOR_MODULE, *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def test_generator_exposes_the_supported_public_api() -> None:
    _generator()


def test_generator_builds_the_frontend_allowlisted_projection() -> None:
    generator = _generator()
    matrix = _valid_matrix()

    generator.validate_matrix(matrix)
    catalog = generator.build_catalog(matrix)

    assert catalog == EXPECTED_CATALOG
    provider = catalog["providers"][0]
    assert set(provider) == set(EXPECTED_CATALOG["providers"][0])
    assert SECRET_CANARY not in json.dumps(catalog, ensure_ascii=False)


@pytest.mark.parametrize(
    ("case", "mutate"),
    [
        (
            "operation declares both projection decisions",
            lambda matrix: matrix["operations"][0].update(
                projection_reason="should be exactly one"
            ),
        ),
        (
            "operation declares neither projection decision",
            lambda matrix: matrix["operations"][0].pop("capability_id"),
        ),
        (
            "user-visible operation uses only a projection reason",
            lambda matrix: (
                matrix["operations"][0].pop("capability_id"),
                matrix["operations"][0].update(
                    projection_reason="User-visible operations require a capability."
                ),
            ),
        ),
        (
            "capability group has an unknown field",
            lambda matrix: matrix["capability_groups"][0].update(unexpected=True),
        ),
        (
            "projection is outside the enum",
            lambda matrix: matrix["capability_groups"][0].update(
                projection="capability_center"
            ),
        ),
        (
            "distribution is outside the enum",
            lambda matrix: matrix["capability_groups"][0].update(distribution="bundle"),
        ),
        (
            "lifecycle is outside the enum",
            lambda matrix: matrix["capability_groups"][0].update(lifecycle="hidden"),
        ),
        (
            "plugin provider has no required readiness source",
            lambda matrix: matrix["capability_groups"][0]["readiness_sources"].update(
                required=[]
            ),
        ),
        (
            "provider alias collides with its canonical key",
            lambda matrix: matrix["capability_groups"][0].update(
                provider_aliases=["opencli-admin/example"]
            ),
        ),
        (
            "secret-bearing fields are forbidden",
            lambda matrix: matrix["capability_groups"][0].update(
                api_token=SECRET_CANARY
            ),
        ),
        (
            "secret-bearing values are forbidden in allowlisted fields",
            lambda matrix: matrix["capability_groups"][0].update(
                label=SECRET_CANARY
            ),
        ),
        (
            "operation frontend routes must stay inside the application",
            lambda matrix: matrix["operations"][0].update(
                frontend_route="//evil.example"
            ),
        ),
        (
            "protocol-relative routes are forbidden",
            lambda matrix: matrix["capability_groups"][0].update(
                target_route="//evil.example"
            ),
        ),
    ],
)
def test_validate_matrix_rejects_contract_violations(case: str, mutate) -> None:
    generator = _generator()
    matrix = copy.deepcopy(_valid_matrix())
    mutate(matrix)

    with pytest.raises(ValueError):
        generator.validate_matrix(matrix)


def test_non_provider_projection_rejects_provider_only_fields() -> None:
    generator = _generator()
    matrix = _valid_matrix()
    group = matrix["capability_groups"][0]
    group["projection"] = "studio_node"

    with pytest.raises(ValueError):
        generator.validate_matrix(matrix)


def test_deprecated_provider_uses_the_shared_lifecycle_note_contract() -> None:
    generator = _generator()
    matrix = _valid_matrix()
    group = matrix["capability_groups"][0]
    group["lifecycle"] = "deprecated"
    group["lifecycle_note"] = "Use provider.replacement before the next release."

    generator.validate_matrix(matrix)
    provider = generator.build_catalog(matrix)["providers"][0]

    assert provider["lifecycleNote"] == group["lifecycle_note"]


def test_retired_unreferenced_wrapper_may_have_no_operation_id() -> None:
    generator = _generator()
    matrix = _valid_matrix()
    matrix["allowed_dispositions"].append("retire")
    matrix["unreferenced_wrappers"] = [
        {
            "wrapper": "retiredGhostWrapper",
            "operation_id": None,
            "disposition": "retire",
            "target_epic": "Phase 0",
            "decision": "Remove the ghost wrapper unless a real contract is added.",
        }
    ]

    generator.validate_matrix(matrix)

    matrix["unreferenced_wrappers"][0]["disposition"] = "operator_ui"
    with pytest.raises(ValueError):
        generator.validate_matrix(matrix)


def test_retired_capability_groups_are_not_discoverable() -> None:
    generator = _generator()
    matrix = _valid_matrix()
    retired_group = copy.deepcopy(matrix["capability_groups"][0])
    retired_group.update(
        capability_id="provider.retired",
        provider_key="opencli-admin/retired",
        provider_aliases=[],
        wrapper_names=[],
        workflow_node_ids=[],
        lifecycle="retired",
    )
    matrix["capability_groups"].append(retired_group)
    retired_operation = copy.deepcopy(matrix["operations"][0])
    retired_operation.update(
        operation_id="get_retired",
        path="/api/v1/retired",
        wrapper=None,
        capability_id="provider.retired",
    )
    matrix["operations"].append(retired_operation)
    matrix["openapi_operation_count"] = 2

    generator.validate_matrix(matrix)
    catalog = generator.build_catalog(matrix)

    assert catalog == EXPECTED_CATALOG
    assert "provider.retired" not in catalog["capabilityIds"]


def test_serialization_is_deterministic_utf8_lf_sorted_and_golden() -> None:
    generator = _generator()
    catalog = generator.build_catalog(_valid_matrix())

    first = generator.serialize_catalog(catalog)
    second = generator.serialize_catalog(copy.deepcopy(catalog))

    assert isinstance(first, bytes)
    assert first == second == _expected_bytes()
    assert hashlib.sha256(first).digest() == hashlib.sha256(second).digest()
    assert b"\r" not in first
    assert first.endswith(b"\n") and not first.endswith(b"\n\n")
    assert "示例 Provider" in first.decode("utf-8")


def test_cli_generates_current_artifact_and_rejects_stale_check(tmp_path: Path) -> None:
    matrix_path = tmp_path / "matrix.yaml"
    output_path = tmp_path / "generated-capability-catalog.json"
    matrix_path.write_text(
        yaml.safe_dump(_valid_matrix(), allow_unicode=True, sort_keys=False),
        encoding="utf-8",
        newline="\n",
    )

    generated = _run_cli(
        "--matrix",
        str(matrix_path),
        "--output",
        str(output_path),
    )
    assert generated.returncode == 0, generated.stderr or generated.stdout
    assert output_path.read_bytes() == _expected_bytes()

    current = _run_cli(
        "--matrix",
        str(matrix_path),
        "--output",
        str(output_path),
        "--check",
    )
    assert current.returncode == 0, current.stderr or current.stdout
    assert output_path.read_bytes() == _expected_bytes()

    output_path.write_text('{"manually": "edited"}\n', encoding="utf-8", newline="\n")
    stale = _run_cli(
        "--matrix",
        str(matrix_path),
        "--output",
        str(output_path),
        "--check",
    )
    stale_message = f"{stale.stdout}\n{stale.stderr}".lower()
    assert stale.returncode != 0
    assert "stale" in stale_message
    assert "python -m scripts.generate_capability_catalog" in stale_message
    assert output_path.read_text(encoding="utf-8") == '{"manually": "edited"}\n'


def test_checked_in_catalog_matches_the_real_matrix() -> None:
    generator = _generator()
    matrix = yaml.safe_load(REAL_MATRIX_PATH.read_text(encoding="utf-8"))
    expected = generator.serialize_catalog(generator.build_catalog(matrix))

    assert REAL_OUTPUT_PATH.exists(), (
        "missing generated catalog; run python -m scripts.generate_capability_catalog"
    )
    assert REAL_OUTPUT_PATH.read_bytes() == expected, (
        "generated catalog is stale; run python -m scripts.generate_capability_catalog "
        f"--matrix {REAL_MATRIX_PATH.relative_to(REPO_ROOT)} "
        f"--output {REAL_OUTPUT_PATH.relative_to(REPO_ROOT)}"
    )
