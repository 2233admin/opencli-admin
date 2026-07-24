"""Persistent, deterministic native simulation over prepared personas."""

from __future__ import annotations

from math import fsum
from typing import Any

from backend.workflow.intelligence_store import (
    IntelligenceCommandResult,
    IntelligenceStore,
)
from backend.workflow.native_intelligence_contracts import (
    ArtifactKind,
    ArtifactProvenance,
    GraphArtifact,
    IntelligenceCommand,
    IntelligenceCommandName,
    PersonaArtifact,
    SimulationArtifact,
    canonical_hash,
    deterministic_id,
)
from backend.workflow.native_intelligence_state import IntelligenceState

ALGORITHM_VERSION = "native-simulation-v1"
MAX_SIMULATION_AGENTS = 50
MAX_SIMULATION_ROUNDS = 80
MAX_SIMULATION_ACTIONS = 500
MAX_SIMULATION_PLATFORMS = 8
MAX_SIMULATION_REQUIREMENT_LENGTH = 1_000
MAX_QUERY_LIMIT = 500
DEFAULT_PLATFORMS = ("community", "news", "social")


def prepare_simulation(
    *,
    session_id: str,
    personas: PersonaArtifact,
    seed: int = 0,
    agent_count: int | None = None,
    max_rounds: int = 8,
    max_actions: int = MAX_SIMULATION_ACTIONS,
    platforms: list[str] | None = None,
    requirement: str = "Explore evidence-grounded reactions across prepared personas.",
) -> dict[str, Any]:
    """Build the bounded canonical checkpoint persisted by ``START``."""

    if personas.session_id != session_id:
        raise ValueError("cross_session_artifact_reference")
    prepared = sorted(
        personas.payload.get("personas", []),
        key=lambda item: str(item.get("personaId", "")),
    )
    count = len(prepared) if agent_count is None else agent_count
    _positive_int(count, "simulation_agent_count", MAX_SIMULATION_AGENTS)
    if count > len(prepared):
        raise ValueError("simulation_agent_count_exceeds_prepared_personas")
    _positive_int(max_rounds, "simulation_round_count", MAX_SIMULATION_ROUNDS)
    _positive_int(max_actions, "simulation_action_count", MAX_SIMULATION_ACTIONS)
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0:
        raise ValueError("simulation_seed_out_of_bounds")
    if not isinstance(requirement, str) or not requirement.strip():
        raise ValueError("simulation_requirement_required")
    requirement = requirement.strip()
    if len(requirement) > MAX_SIMULATION_REQUIREMENT_LENGTH:
        raise ValueError("simulation_requirement_too_long")
    selected_platforms = _platforms(platforms)
    config = {
        "agentCount": count,
        "maxRounds": max_rounds,
        "maxActions": max_actions,
        "platforms": selected_platforms,
        "requirement": requirement,
    }
    manifest = {
        "schema": "intelligence.simulation.checkpoint.v1",
        "personaArtifactId": personas.artifact_id,
        "graphArtifactId": _persona_graph_id(personas),
        "seed": seed,
        "config": config,
        "currentRound": 0,
        "actionCount": 0,
        "actionsHash": canonical_hash([]),
    }
    _validate_manifest(manifest)
    return manifest


def simulation_snapshot(
    personas: PersonaArtifact,
    manifest: dict[str, Any],
) -> dict[str, Any]:
    """Recompute the exact bounded view represented by a persisted checkpoint."""

    _validate_manifest(manifest)
    if manifest["personaArtifactId"] != personas.artifact_id:
        raise ValueError("simulation_persona_artifact_mismatch")
    if manifest["graphArtifactId"] != _persona_graph_id(personas):
        raise ValueError("simulation_graph_artifact_mismatch")
    view = _simulate(personas, manifest)
    actions = view["actions"]
    if manifest["actionCount"] != len(actions):
        raise ValueError("simulation_checkpoint_action_count_mismatch")
    if manifest["actionsHash"] != canonical_hash(actions):
        raise ValueError("simulation_checkpoint_actions_hash_mismatch")
    return {
        **view,
        "outcomes": {
            "supportRatio": view["stats"]["supportRatio"],
            "opposeRatio": view["stats"]["opposeRatio"],
            "neutralRatio": view["stats"]["neutralRatio"],
            "polarization": view["stats"]["polarization"],
            "dominantAction": view["stats"]["dominantAction"],
            "scenario": _scenario(view["stats"]),
        },
    }


def advance_simulation(
    personas: PersonaArtifact,
    manifest: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Advance exactly one round and return its canonical checkpoint and view."""

    _validate_manifest(manifest)
    if manifest["currentRound"] >= manifest["config"]["maxRounds"]:
        return dict(manifest), simulation_snapshot(personas, manifest)
    next_manifest = {
        **manifest,
        "currentRound": manifest["currentRound"] + 1,
    }
    partial = _simulate(personas, next_manifest)
    next_manifest["actionCount"] = len(partial["actions"])
    next_manifest["actionsHash"] = canonical_hash(partial["actions"])
    return next_manifest, simulation_snapshot(personas, next_manifest)


def build_simulation_artifact(
    *,
    session_id: str,
    personas: PersonaArtifact,
    manifest: dict[str, Any],
) -> SimulationArtifact:
    snapshot = simulation_snapshot(personas, manifest)
    if manifest["currentRound"] != manifest["config"]["maxRounds"]:
        raise ValueError("simulation_not_complete")
    payload = {
        "schema": "intelligence.simulation.v1",
        "simulated": True,
        "status": "completed",
        "personaArtifactId": personas.artifact_id,
        "graphArtifactId": manifest["graphArtifactId"],
        "seed": manifest["seed"],
        "config": manifest["config"],
        "roundsCompleted": manifest["currentRound"],
        **snapshot,
        "limits": {
            "maxAgents": MAX_SIMULATION_AGENTS,
            "maxRounds": MAX_SIMULATION_ROUNDS,
            "maxActions": MAX_SIMULATION_ACTIONS,
        },
    }
    return SimulationArtifact(
        artifact_id=deterministic_id(
            "simulation",
            {"algorithm": ALGORITHM_VERSION, "payload": payload},
        ),
        session_id=session_id,
        payload=payload,
        grounding_artifact_ids=[
            personas.artifact_id,
            manifest["graphArtifactId"],
        ],
        simulated=True,
        provenance=ArtifactProvenance(
            source="opencli-native-deterministic",
            evidence_artifact_ids=[
                personas.artifact_id,
                manifest["graphArtifactId"],
            ],
        ),
        algorithm_version=ALGORITHM_VERSION,
        seed=manifest["seed"],
    )


class NativeSimulationStages:
    """Aggregate-backed simulation commands and bounded persisted queries."""

    def __init__(self, store: IntelligenceStore):
        self.store = store

    async def start(
        self,
        *,
        session_id: str,
        expected_version: int,
        personas: PersonaArtifact | None = None,
        persona_artifact_id: str | None = None,
        seed: int = 0,
        agent_count: int | None = None,
        max_rounds: int = 8,
        max_actions: int = MAX_SIMULATION_ACTIONS,
        platforms: list[str] | None = None,
        requirement: str = "Explore evidence-grounded reactions across prepared personas.",
    ) -> IntelligenceCommandResult:
        requested_artifact_id = persona_artifact_id or (
            personas.artifact_id if personas is not None else None
        )
        if not requested_artifact_id:
            raise ValueError("simulation_requires_persona_artifact")
        persisted = await self.store.load_artifact(session_id, requested_artifact_id)
        if not isinstance(persisted, PersonaArtifact):
            raise ValueError("simulation_requires_persona_artifact")
        if (
            personas is not None
            and canonical_hash(personas.model_dump(mode="json"))
            != canonical_hash(persisted.model_dump(mode="json"))
        ):
            raise ValueError("simulation_persona_artifact_content_mismatch")
        graph_id = _persona_graph_id(persisted)
        graph = await self.store.load_artifact(session_id, graph_id)
        if not isinstance(graph, GraphArtifact):
            raise ValueError("simulation_requires_graph_grounding")
        manifest = prepare_simulation(
            session_id=session_id,
            personas=persisted,
            seed=seed,
            agent_count=agent_count,
            max_rounds=max_rounds,
            max_actions=max_actions,
            platforms=platforms,
            requirement=requirement,
        )
        request = {
            "personaArtifactId": persisted.artifact_id,
            "graphArtifactId": graph_id,
            "seed": seed,
            "config": manifest["config"],
            "checkpoint_manifest": manifest,
        }
        return await self.store.apply(
            _command(
                IntelligenceCommandName.START,
                session_id,
                expected_version,
                f"simulation-start:{canonical_hash(request)}",
                request,
            )
        )

    async def step(
        self,
        *,
        session_id: str,
        expected_version: int,
    ) -> tuple[IntelligenceCommandResult, SimulationArtifact | None]:
        aggregate = await self.store.load_session(session_id)
        step_key = f"native:simulation-step:{session_id}:{expected_version}"
        if aggregate.state == IntelligenceState.SIMULATED:
            artifact = await self.store.load_latest_artifact(
                session_id, ArtifactKind.SIMULATION
            )
            if not isinstance(artifact, SimulationArtifact):
                raise ValueError("simulation_artifact_missing")
            return (
                IntelligenceCommandResult(
                    session_id=session_id,
                    state=aggregate.state,
                    version=aggregate.version,
                    transition_event_id=None,
                    artifact_ids=(artifact.artifact_id,),
                    idempotent_replay=True,
                ),
                artifact,
            )
        replay = await self.store.load_command_result(session_id, step_key)
        if replay is not None:
            return replay, None
        if aggregate.state != IntelligenceState.RUNNING:
            raise ValueError("simulation_not_running")
        manifest = dict(aggregate.checkpoint_manifest or {})
        personas = await self._personas(session_id, manifest)
        next_manifest, _ = advance_simulation(personas, manifest)
        target_round = next_manifest["currentRound"]
        stepped = await self.store.apply(
            _command(
                IntelligenceCommandName.STEP,
                session_id,
                expected_version,
                f"simulation-step:{session_id}:{expected_version}",
                {
                    "operationId": aggregate.operation_id,
                    "targetRound": target_round,
                    "checkpoint_manifest": next_manifest,
                },
            )
        )
        if target_round < next_manifest["config"]["maxRounds"]:
            return stepped, None
        artifact = build_simulation_artifact(
            session_id=session_id,
            personas=personas,
            manifest=next_manifest,
        )
        completed = await self.store.apply(
            _command(
                IntelligenceCommandName.SIMULATION_COMPLETE,
                session_id,
                stepped.version,
                f"simulation-complete:{artifact.artifact_id}",
                {"artifactId": artifact.artifact_id},
            ),
            artifacts=[artifact],
        )
        return completed, artifact

    async def run(
        self,
        *,
        session_id: str,
        expected_version: int,
    ) -> tuple[IntelligenceCommandResult, SimulationArtifact]:
        version = expected_version
        while True:
            result, artifact = await self.step(
                session_id=session_id,
                expected_version=version,
            )
            version = result.version
            if artifact is not None:
                return result, artifact

    async def stop(
        self, *, session_id: str, expected_version: int
    ) -> IntelligenceCommandResult:
        aggregate = await self.store.load_session(session_id)
        manifest = aggregate.checkpoint_manifest or {}
        return await self.store.apply(
            _command(
                IntelligenceCommandName.STOP,
                session_id,
                expected_version,
                f"simulation-stop:{aggregate.operation_id}:{manifest.get('currentRound', 0)}",
                {
                    "operationId": aggregate.operation_id,
                    "checkpointHash": canonical_hash(manifest),
                },
            )
        )

    async def resume(
        self, *, session_id: str, expected_version: int
    ) -> IntelligenceCommandResult:
        aggregate = await self.store.load_session(session_id)
        manifest = aggregate.checkpoint_manifest or {}
        return await self.store.apply(
            _command(
                IntelligenceCommandName.RESUME,
                session_id,
                expected_version,
                f"simulation-resume:{aggregate.operation_id}:{manifest.get('currentRound', 0)}",
                {
                    "operationId": aggregate.operation_id,
                    "checkpointHash": canonical_hash(manifest),
                },
            )
        )

    async def cancel(
        self, *, session_id: str, expected_version: int
    ) -> IntelligenceCommandResult:
        aggregate = await self.store.load_session(session_id)
        manifest = aggregate.checkpoint_manifest or {}
        return await self.store.apply(
            _command(
                IntelligenceCommandName.CANCEL,
                session_id,
                expected_version,
                f"simulation-cancel:{aggregate.operation_id}:{manifest.get('currentRound', 0)}",
                {
                    "operationId": aggregate.operation_id,
                    "checkpointHash": canonical_hash(manifest),
                },
            )
        )

    async def status(self, *, session_id: str) -> dict[str, Any]:
        aggregate = await self.store.load_session(session_id)
        artifact = await self.store.load_latest_artifact(
            session_id, ArtifactKind.SIMULATION
        )
        manifest = aggregate.checkpoint_manifest or {}
        if artifact is not None:
            return {
                "sessionId": session_id,
                "state": aggregate.state.value,
                "version": aggregate.version,
                "operationId": aggregate.operation_id,
                "currentRound": artifact.payload["roundsCompleted"],
                "maxRounds": artifact.payload["config"]["maxRounds"],
                "actionCount": len(artifact.payload["actions"]),
                "artifactId": artifact.artifact_id,
                "complete": True,
            }
        return {
            "sessionId": session_id,
            "state": aggregate.state.value,
            "version": aggregate.version,
            "operationId": aggregate.operation_id,
            "currentRound": manifest.get("currentRound", 0),
            "maxRounds": (manifest.get("config") or {}).get("maxRounds", 0),
            "actionCount": manifest.get("actionCount", 0),
            "artifactId": None,
            "complete": False,
        }

    async def actions(
        self, *, session_id: str, offset: int = 0, limit: int = 100
    ) -> list[dict[str, Any]]:
        view = await self._view(session_id)
        _query_bounds(offset, limit)
        return view["actions"][offset : offset + limit]

    async def timeline(
        self, *, session_id: str, offset: int = 0, limit: int = 100
    ) -> list[dict[str, Any]]:
        view = await self._view(session_id)
        _query_bounds(offset, limit)
        return view["timeline"][offset : offset + limit]

    async def stats(self, *, session_id: str) -> dict[str, Any]:
        return (await self._view(session_id))["stats"]

    async def _view(self, session_id: str) -> dict[str, Any]:
        aggregate = await self.store.load_session(session_id)
        artifact = await self.store.load_latest_artifact(
            session_id, ArtifactKind.SIMULATION
        )
        if artifact is not None:
            return artifact.payload
        manifest = dict(aggregate.checkpoint_manifest or {})
        personas = await self._personas(session_id, manifest)
        return simulation_snapshot(personas, manifest)

    async def _personas(
        self, session_id: str, manifest: dict[str, Any]
    ) -> PersonaArtifact:
        artifact_id = manifest.get("personaArtifactId")
        if not artifact_id:
            raise ValueError("simulation_checkpoint_missing_personas")
        artifact = await self.store.load_artifact(session_id, artifact_id)
        if not isinstance(artifact, PersonaArtifact):
            raise ValueError("simulation_requires_persona_artifact")
        return artifact


def _simulate(
    personas: PersonaArtifact, manifest: dict[str, Any]
) -> dict[str, Any]:
    config = manifest["config"]
    selected = sorted(
        personas.payload.get("personas", []),
        key=lambda item: str(item.get("personaId", "")),
    )[: config["agentCount"]]
    profiles = [_initial_profile(item, manifest["seed"]) for item in selected]
    actions: list[dict[str, Any]] = []
    timeline: list[dict[str, Any]] = []
    for round_number in range(1, manifest["currentRound"] + 1):
        mean_before = round(
            fsum(sorted(float(profile["stance"]) for profile in profiles))
            / len(profiles),
            6,
        )
        round_actions: list[dict[str, Any]] = []
        for position, profile in enumerate(profiles):
            if len(actions) >= config["maxActions"]:
                break
            if (
                _unit(
                    manifest["seed"],
                    "activity",
                    round_number,
                    profile["personaId"],
                )
                > float(profile["activity"])
            ):
                continue
            social_pull = (mean_before - float(profile["stance"])) * (
                0.08 + float(profile["influence"]) * 0.04
            )
            shock = (
                _unit(
                    manifest["seed"],
                    "shock",
                    round_number,
                    profile["personaId"],
                )
                - 0.5
            ) * 0.16
            profile["stance"] = round(
                max(min(float(profile["stance"]) + social_pull + shock, 1.0), -1.0),
                6,
            )
            action = {
                "actionId": deterministic_id(
                    "simulation_action",
                    {
                        "personaArtifactId": personas.artifact_id,
                        "seed": manifest["seed"],
                        "round": round_number,
                        "personaId": profile["personaId"],
                    },
                ),
                "round": round_number,
                "platform": config["platforms"][
                    (round_number + position) % len(config["platforms"])
                ],
                "agentId": profile["agentId"],
                "personaId": profile["personaId"],
                "action": _action_type(
                    float(profile["stance"]),
                    _unit(
                        manifest["seed"],
                        "action",
                        round_number,
                        profile["personaId"],
                    ),
                ),
                "stance": profile["stance"],
                "topic": profile["interest"],
                "simulated": True,
            }
            actions.append(action)
            round_actions.append(action)
        mean_after = round(
            fsum(sorted(float(profile["stance"]) for profile in profiles))
            / len(profiles),
            6,
        )
        timeline.append(
            {
                "round": round_number,
                "actionCount": len(round_actions),
                "meanStanceBefore": mean_before,
                "meanStanceAfter": mean_after,
                "actionIds": [action["actionId"] for action in round_actions],
                "simulated": True,
            }
        )
    return {
        "profiles": profiles,
        "timeline": timeline,
        "actions": actions,
        "stats": _stats(profiles, actions),
    }


def _initial_profile(persona: dict[str, Any], seed: int) -> dict[str, Any]:
    persona_id = str(persona["personaId"])
    return {
        "agentId": deterministic_id(
            "simulation_agent", {"personaId": persona_id, "seed": seed}
        ),
        "personaId": persona_id,
        "archetype": str(persona.get("role") or "observer"),
        "interest": str(persona.get("name") or "prepared evidence"),
        "influence": round(0.2 + _unit(seed, "influence", persona_id) * 0.8, 6),
        "activity": round(0.25 + _unit(seed, "activity-rate", persona_id) * 0.75, 6),
        "stance": round((_unit(seed, "stance", persona_id) - 0.5) * 1.2, 6),
        "groundingPersonaId": persona_id,
        "simulated": True,
    }


def _unit(seed: int, *parts: object) -> float:
    digest = canonical_hash({"seed": seed, "parts": parts})
    return int(digest[:13], 16) / float(16**13 - 1)


def _action_type(stance: float, draw: float) -> str:
    if abs(stance) < 0.18:
        return "observe" if draw < 0.6 else "ask"
    if stance > 0:
        return "amplify" if draw < 0.55 else "support"
    return "challenge" if draw < 0.55 else "warn"


def _stats(
    profiles: list[dict[str, Any]], actions: list[dict[str, Any]]
) -> dict[str, Any]:
    stances = sorted(float(profile["stance"]) for profile in profiles)
    support = sum(stance > 0.2 for stance in stances)
    oppose = sum(stance < -0.2 for stance in stances)
    neutral = len(stances) - support - oppose
    breakdown: dict[str, int] = {}
    for action in actions:
        name = str(action["action"])
        breakdown[name] = breakdown.get(name, 0) + 1
    dominant = min(
        (
            (-count, name)
            for name, count in breakdown.items()
        ),
        default=(0, "none"),
    )[1]
    count = len(stances)
    return {
        "agentCount": count,
        "actionCount": len(actions),
        "supportRatio": round(support / count, 6),
        "opposeRatio": round(oppose / count, 6),
        "neutralRatio": round(neutral / count, 6),
        "polarization": round(fsum(abs(value) for value in stances) / count, 6),
        "dominantAction": dominant,
        "actionBreakdown": dict(sorted(breakdown.items())),
    }


def _scenario(stats: dict[str, Any]) -> str:
    support = stats["supportRatio"]
    oppose = stats["opposeRatio"]
    neutral = stats["neutralRatio"]
    if support > oppose * 1.5 and support > neutral:
        return "support_dominant"
    if oppose > support * 1.5 and oppose > neutral:
        return "risk_dominant"
    if neutral >= max(support, oppose):
        return "evidence_sensitive"
    return "contested"


def _platforms(platforms: list[str] | None) -> list[str]:
    values = list(DEFAULT_PLATFORMS) if platforms is None else platforms
    if not isinstance(values, list) or not 1 <= len(values) <= MAX_SIMULATION_PLATFORMS:
        raise ValueError("simulation_platform_count_out_of_bounds")
    normalized: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > 50:
            raise ValueError("invalid_simulation_platform")
        normalized.append(value.strip())
    if len(set(normalized)) != len(normalized):
        raise ValueError("duplicate_simulation_platform")
    return sorted(normalized)


def _validate_manifest(manifest: dict[str, Any]) -> None:
    if manifest.get("schema") != "intelligence.simulation.checkpoint.v1":
        raise ValueError("invalid_simulation_checkpoint")
    config = manifest.get("config")
    if not isinstance(config, dict):
        raise ValueError("invalid_simulation_checkpoint_config")
    _positive_int(
        config.get("agentCount"), "simulation_agent_count", MAX_SIMULATION_AGENTS
    )
    _positive_int(
        config.get("maxRounds"), "simulation_round_count", MAX_SIMULATION_ROUNDS
    )
    _positive_int(
        config.get("maxActions"), "simulation_action_count", MAX_SIMULATION_ACTIONS
    )
    current_round = manifest.get("currentRound")
    if (
        not isinstance(current_round, int)
        or isinstance(current_round, bool)
        or not 0 <= current_round <= config["maxRounds"]
    ):
        raise ValueError("invalid_simulation_checkpoint_round")
    if not isinstance(manifest.get("actionCount"), int) or manifest["actionCount"] < 0:
        raise ValueError("invalid_simulation_checkpoint_action_count")
    if not isinstance(manifest.get("actionsHash"), str):
        raise ValueError("invalid_simulation_checkpoint_actions_hash")
    if not isinstance(manifest.get("graphArtifactId"), str):
        raise ValueError("invalid_simulation_checkpoint_graph_artifact")
    _platforms(config.get("platforms"))


def _persona_graph_id(personas: PersonaArtifact) -> str:
    graph_id = personas.payload.get("graphArtifactId")
    if (
        not isinstance(graph_id, str)
        or not graph_id
        or graph_id not in personas.grounding_artifact_ids
    ):
        raise ValueError("simulation_requires_graph_grounding")
    return graph_id


def _positive_int(value: Any, name: str, maximum: int) -> None:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or not 1 <= value <= maximum
    ):
        raise ValueError(f"{name}_out_of_bounds")


def _query_bounds(offset: int, limit: int) -> None:
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
        raise ValueError("simulation_query_offset_out_of_bounds")
    _positive_int(limit, "simulation_query_limit", MAX_QUERY_LIMIT)


def _command(
    name: IntelligenceCommandName,
    session_id: str,
    version: int,
    idempotency_key: str,
    request: dict[str, Any],
) -> IntelligenceCommand:
    return IntelligenceCommand(
        command=name,
        session_id=session_id,
        expected_version=version,
        idempotency_key=f"native:{idempotency_key}",
        request=request,
    )


__all__ = [
    "ALGORITHM_VERSION",
    "MAX_QUERY_LIMIT",
    "MAX_SIMULATION_ACTIONS",
    "MAX_SIMULATION_AGENTS",
    "MAX_SIMULATION_PLATFORMS",
    "MAX_SIMULATION_ROUNDS",
    "NativeSimulationStages",
    "advance_simulation",
    "build_simulation_artifact",
    "prepare_simulation",
    "simulation_snapshot",
]
