from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_agent_image_packages_runtime_adapter_modules():
    dockerfile = (ROOT / "agent" / "Dockerfile").read_text(encoding="utf-8")

    assert "COPY backend/agent_server.py ./backend/agent_server.py" in dockerfile
    assert "COPY backend/agent_runtimes/ ./backend/agent_runtimes/" in dockerfile
    assert "COPY backend/miniflow/ ./backend/miniflow/" in dockerfile


def test_agent_image_pins_managed_acquisition_runtime():
    dockerfile = (ROOT / "agent" / "Dockerfile").read_text(encoding="utf-8")

    assert "ARG OPENCLI_VERSION=1.8.5" in dockerfile
    assert (
        "ARG OHMYOPENCLI_COMMIT="
        "8a087abe1805a9cff77b64ba80da12379afa184e"
    ) in dockerfile
    assert "git checkout --detach ${OHMYOPENCLI_COMMIT}" in dockerfile
    assert "npm ci" in dockerfile
    assert "npm run bootstrap" in dockerfile
    assert "OHMYOPENCLI_ROOT=/opt/ohmyopencli" in dockerfile
    assert "COPY scripts/patch-opencli.js /tmp/patch-opencli.js" in dockerfile
    assert "node /tmp/patch-opencli.js" in dockerfile


def test_managed_runtime_plugin_is_registered_for_each_final_image_user():
    cases = [
        (ROOT / "Dockerfile", "appuser", "/home/appuser"),
        (ROOT / "agent" / "Dockerfile", "agent", "/home/agent"),
    ]

    for path, user, home in cases:
        dockerfile = path.read_text(encoding="utf-8")
        user_creation = dockerfile.index(f"useradd -m -u 1000 {user}")
        user_bootstrap = dockerfile.index(f"HOME={home} npm run bootstrap")
        final_user = dockerfile.index(f"USER {user}")

        assert user_creation < user_bootstrap < final_user


def test_anonymous_agent_profiles_are_fresh_per_agent_start():
    entrypoint = (ROOT / "agent" / "entrypoint.sh").read_text(encoding="utf-8")
    installer = (ROOT / "scripts" / "install-agent.sh").read_text(encoding="utf-8")

    assert 'OPENCLI_BROWSER_PROFILE_KIND:-authenticated' in entrypoint
    assert "mktemp -d /tmp/opencli-anonymous-profile.XXXXXX" in entrypoint
    assert 'OPENCLI_BROWSER_PROFILE_KIND" == "anonymous"' in installer
    assert "mktemp -d /tmp/opencli-anonymous-profile.XXXXXX" in installer
