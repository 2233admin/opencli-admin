from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_agent_image_packages_runtime_adapter_modules():
    dockerfile = (ROOT / "agent" / "Dockerfile").read_text(encoding="utf-8")

    assert "COPY backend/agent_server.py ./backend/agent_server.py" in dockerfile
    assert "COPY backend/agent_runtimes/ ./backend/agent_runtimes/" in dockerfile
    assert "COPY backend/miniflow/ ./backend/miniflow/" in dockerfile

