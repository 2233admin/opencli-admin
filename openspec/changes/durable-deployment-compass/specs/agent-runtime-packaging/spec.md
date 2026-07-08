## ADDED Requirements

### Requirement: Agent images package runtime modules
Agent deployment artifacts SHALL include the server and runtime modules needed
for advertised runtimes.

#### Scenario: Docker Agent image starts
- **WHEN** the Docker Agent image starts
- **THEN** it can import `backend.agent_runtimes`, load built-in runtime adapters, and advertise available runtime ids without requiring source checkout bind mounts.

#### Scenario: Runtime module is missing
- **WHEN** an Agent cannot import a runtime package needed for its advertised support state
- **THEN** the runtime is not advertised and deployment PTT fails for that profile.

### Requirement: Runtime support is explicit
Each Agent runtime profile MUST declare dependencies, health probe, version,
allowlist, working directory policy, artifact policy, and trace mapping before
it is supported.

#### Scenario: MiniFlow is enabled on NAS
- **WHEN** MiniFlow runtime is enabled on a NAS Agent
- **THEN** workflow paths are constrained to approved directories, audit artifacts are persisted, runtime version is visible, and run events map to workflow trace.

#### Scenario: OpenTabs is enabled
- **WHEN** OpenTabs runtime is enabled on an Agent
- **THEN** server URL, secret handling, extension/server health, `/tools` manifest projection, and a read-only smoke are part of PTT evidence.

### Requirement: Shell/systemd Agent distributes runtime packages
The shell/systemd Agent installer MUST install or download all Python runtime
packages required by the Agent server.

#### Scenario: Python install mode is used
- **WHEN** an operator installs an Agent with shell/systemd Python mode
- **THEN** `agent_server.py`, `backend/agent_runtimes`, built-in runtime modules, and runtime dependencies are present in the Agent directory.

#### Scenario: Installer only downloads the server file
- **WHEN** Python install mode only downloads `agent_server.py`
- **THEN** runtime support remains blocked for that deployment profile.

