"""Readable names for data sources materialized by workflow record sinks."""

from backend.schemas.workflow import CompiledWorkflowNode
from backend.workflow.opencli_hda_tracer import _workflow_source_config, _workflow_source_display_name


def test_workflow_source_display_uses_the_canvas_label_not_the_runtime_path() -> None:
    node = CompiledWorkflowNode(
        id="ashare-market-intelligence-sources::source-finance-news",
        kind="source",
        capability="fetch",
        params={"sourceGroup": "finance-news"},
        runtime={"display_name": "新浪财经新闻"},
    )

    assert _workflow_source_display_name(node) == "新浪财经新闻 · 工作流扫描数据源"
    assert _workflow_source_config(node, workflow_id="workflow-1", run_id="run-1")["sourceNodeId"] == node.id
