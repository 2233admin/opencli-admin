from backend.schemas.workflow import WorkflowProject
from backend.workflow import hda_templates


def _template_project() -> WorkflowProject:
    return WorkflowProject.model_validate(
        {
            "id": "freeze-template",
            "name": "Freeze template",
            "profile": "intelligence",
            "version": 1,
            "nodes": [
                {
                    "id": "multi-source",
                    "kind": "agent",
                    "capability": "normalize",
                    "params": {
                        "template": "opencli-multi-source",
                        "sources": [
                            {
                                "id": "bilibili",
                                "site": "bilibili",
                                "command": "search",
                            }
                        ],
                    },
                    "ui": {"catalogId": "package.opencli.multi-source-hda"},
                }
            ],
            "edges": [],
        }
    )


def test_frozen_hda_keeps_published_internals_when_template_catalog_changes(monkeypatch):
    frozen = hda_templates.freeze_hda_templates(_template_project())
    package = frozen.nodes[0]
    assert package.params["templateFrozen"] is True
    assert package.internals is not None
    frozen_internals = package.internals.model_dump(mode="json")

    def changed_template(_sources):
        raise AssertionError("frozen published graph must not consult the current template catalog")

    monkeypatch.setattr(hda_templates, "_opencli_multi_source_internals", changed_template)

    rematerialized = hda_templates.materialize_hda_templates(frozen, trust_frozen=True)
    assert rematerialized.nodes[0].internals is not None
    assert rematerialized.nodes[0].internals.model_dump(mode="json") == frozen_internals


def test_draft_cannot_forge_frozen_template_internals():
    forged = _template_project().model_dump(mode="json")
    forged_package = forged["nodes"][0]
    forged_package["params"]["templateFrozen"] = True
    forged_package["internals"] = {
        "locked": False,
        "nodes": [
            {
                "id": "forged",
                "kind": "agent",
                "capability": "normalize",
                "params": {},
            }
        ],
        "edges": [],
    }

    materialized = hda_templates.materialize_hda_templates(
        WorkflowProject.model_validate(forged)
    )

    package = materialized.nodes[0]
    assert package.internals is not None
    assert package.params.get("templateFrozen") is not True
    assert all(node.id != "forged" for node in package.internals.nodes)


def test_freeze_recursively_materializes_nested_template_packages():
    nested = _template_project().nodes[0].model_dump(mode="json")
    project = WorkflowProject.model_validate(
        {
            "id": "nested-template",
            "name": "Nested template",
            "profile": "intelligence",
            "version": 1,
            "nodes": [
                {
                    "id": "outer-package",
                    "kind": "agent",
                    "capability": "normalize",
                    "params": {},
                    "internals": {"locked": False, "nodes": [nested], "edges": []},
                }
            ],
            "edges": [],
        }
    )

    frozen = hda_templates.freeze_hda_templates(project)
    nested_package = frozen.nodes[0].internals.nodes[0]

    assert nested_package.params["templateFrozen"] is True
    assert nested_package.internals is not None
    assert nested_package.internals.nodes
    assert any(adapter.id == "opencli-bilibili" for adapter in frozen.adapters)
