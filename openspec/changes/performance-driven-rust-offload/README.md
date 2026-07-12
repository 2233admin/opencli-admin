# Performance-driven Rust offload

Status: deferred product PRD; implement only after the canonical Workflow Version and Run facts exist.

## Problem Statement

Collection, transformation, delivery, and local data-plane workloads may eventually exceed the latency, throughput, memory, or deployment envelope of the current Python execution path. Rewriting the Control Plane in Rust would create migration risk without proving that business APIs, policy, Agent orchestration, or configuration are the bottleneck.

## Solution

Use the existing code-intel and performance pipeline to identify a reproducible hotspot. Move only the measured hot path into a versioned Rust Tool or Worker, then register it through the same Node manifest, capability, Task, Artifact, Gate, and audit contracts used by every other runtime.

Rust offload is an implementation choice behind a Tool capability. A Workflow must not change meaning because its implementation moves from Python to Rust.

## User Stories

1. As an operator, I want slow data paths identified from measurements, so that optimization work targets actual bottlenecks.
2. As a workflow author, I want a Rust-backed Node to behave like any other Node, so that workflows do not require a second execution model.
3. As a self-hosted user, I want lightweight Rust Workers on NAS and edge Devices, so that high-throughput processing does not require a large Python environment.
4. As an administrator, I want Rust Workers to report Verified Capabilities and health, so that the scheduler can place tasks safely.
5. As an auditor, I want Rust-backed attempts to produce the same Run Events and Artifact provenance, so that performance optimization does not weaken traceability.
6. As a developer, I want Python and Rust implementations compared with the same fixtures, so that migration preserves behavior.
7. As an integrator, I want external projects to call the same stable Tool contract, so that optimized capabilities can be reused outside OpenCLI Admin.

## Implementation Decisions

- Keep FastAPI/Python as the Control Plane for Project, Workflow, Automation, policy, Gate, Inbox, Agent, and configuration behavior.
- Consider Rust first for streaming collection, parsing, cleaning, hashing, deduplication, compression, indexing, file transfer, and high-throughput Worker loops.
- Require a benchmark artifact before approving Rust work. It must record workload, dataset, concurrency, latency percentiles, throughput, peak memory, CPU, failure rate, and current implementation version.
- Default promotion threshold: a user-visible or capacity-limiting path whose measured p95 latency, throughput, or memory misses an agreed product SLO in three repeatable runs. “Rust is faster” is not sufficient evidence.
- Use the local code-intel pipeline to locate call paths, coupling, tests, blast radius, and migration seams before generating or translating Rust code.
- Batch migration may use the existing Rust scaling workflow, but each batch is gated by contract equivalence, benchmark improvement, and structural checks.
- A Rust implementation registers as a Tool/RuntimeAdapter capability and executes as a normal TaskAttempt on a RuntimeTarget/Worker.
- Inputs and outputs use versioned, language-neutral contracts. Large outputs remain immutable Artifacts rather than Event payloads.
- Keep the Python implementation as a comparison/fallback until equivalence, operational telemetry, rollback, and deployment packaging pass.
- Pake/Tauri is a separate optional desktop distribution surface; it is not the Rust Worker framework or a backend performance migration mechanism.

## Testing Decisions

- Primary seam: run the same Node contract fixture through the Python and Rust implementations and compare normalized outputs, effects, Artifacts, and error classes.
- Benchmark the highest public execution seam, including serialization and process/network overhead rather than timing an isolated inner loop.
- Verify cancellation, timeout, retry, duplicate delivery, Worker loss, and non-idempotent side-effect handling.
- Require p50/p95/p99 latency, throughput, peak RSS, CPU, and cold-start results on representative NAS, workstation, and CI hardware.
- Run code-intel structural gates before and after each migration batch; reject increased boundary violations or untested blast radius.
- Verify that Workflow definitions, Run Trace, Inbox/Gate behavior, and Artifact provenance remain implementation-language neutral.

## Delivery Phases

1. Establish SLOs and benchmark harnesses for real collection, cleaning, and delivery paths.
2. Use profiling plus code-intel artifacts to rank hotspots and choose one narrow vertical slice.
3. Define or confirm the language-neutral Tool and Node contract.
4. Implement a Rust Tool/Worker behind the existing runtime registry.
5. Shadow or differential-run it against Python fixtures and representative workloads.
6. Promote gradually with explicit fallback and rollback.
7. Repeat only for the next measured bottleneck.

## Out of Scope

- Rewriting the FastAPI Control Plane or React frontend in Rust.
- Replacing the canonical Node engine, Workflow model, Run facts, Gate, or Artifact model.
- Rust migration based only on preference, language popularity, or synthetic microbenchmarks.
- Creating a second scheduler, permission system, Agent runtime, or audit trail.
- Using Pake as a backend framework.

## Acceptance Criteria

- A checked-in benchmark report proves the original SLO miss and the Rust improvement.
- Python and Rust implementations pass the same external contract suite.
- The Rust capability appears through the existing Node/runtime capability projection.
- Runs retain TaskAttempt, RuntimeTarget, Worker, Event, Gate, and Artifact evidence.
- Failure and rollback do not require modifying or republishing the Workflow.
- Code-intel and structural gates pass for the migrated scope.

## Further Notes

This is deliberately sequenced after persistent Project, WorkflowVersion, pinned Run, and canonical Artifact work. Those facts provide the stable boundary needed to optimize execution without changing product semantics.
