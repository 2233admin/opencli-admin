"""Versioned managed-acquisition capabilities backed by real OpenCLI commands."""

from dataclasses import dataclass

OHMYOPENCLI_COMMIT = "73cc60c83586ef2c95469b3b70d6cfc80fa5bc53"
OFFICIAL_SITE_CAPABILITY_COMMIT = "73cc60c83586ef2c95469b3b70d6cfc80fa5bc53"
OPENCLI_VERSION = "1.8.5"


@dataclass(frozen=True)
class CapabilityRegistration:
    capability_id: str
    capability_version: str
    output_schema_version: str
    source_commit: str
    invocation: dict[str, str]
    probe_args: tuple[str, ...]
    help_marker: str
    route_probe_args: tuple[str, ...]
    route_probe_error: str
    required_profile_kind: str = "anonymous"

    @property
    def identity(self) -> tuple[str, str, str]:
        return (
            self.capability_id,
            self.capability_version,
            self.output_schema_version,
        )

    def runtime_identity(self) -> dict[str, str]:
        return {
            "ohmyopencli_repo_commit": OHMYOPENCLI_COMMIT,
            "capability_source_commit": self.source_commit,
            "opencli_version": OPENCLI_VERSION,
        }


_REGISTRATIONS = (
    CapabilityRegistration(
        capability_id="official-site.observe",
        capability_version="1.0.0",
        output_schema_version="1",
        source_commit=OFFICIAL_SITE_CAPABILITY_COMMIT,
        invocation={
            "site": "official-site",
            "command": "observe",
            "format": "json",
        },
        probe_args=("official-site", "observe", "--help"),
        help_marker="official-site observe",
        route_probe_args=(
            "official-site",
            "observe",
            "--url",
            "https://example.invalid",
            "-f",
            "json",
        ),
        route_probe_error="CDP not reachable at http://127.0.0.1:9",
    ),
)


def list_capability_registrations() -> tuple[CapabilityRegistration, ...]:
    """Return the audited capabilities that Admin is allowed to dispatch."""
    return _REGISTRATIONS


def get_capability_registration(
    capability_id: str,
    capability_version: str,
    output_schema_version: str,
) -> CapabilityRegistration | None:
    identity = (capability_id, capability_version, output_schema_version)
    return next(
        (registration for registration in _REGISTRATIONS if registration.identity == identity),
        None,
    )
