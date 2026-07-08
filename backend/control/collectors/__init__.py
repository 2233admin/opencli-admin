"""System-level (not per-source) collectors for the control layer.

See docs/CONTROL_THEORY_ARCHITECTURE.md. Unlike backend/control/aggregation.py
(which builds a per-source SourceMeasurement from this app's own DB), this
package reaches across the ODP boundary — Redis Streams consumer-group state
and the ODP Postgres DLQ table — to answer "how healthy is the ODP data plane
as a whole". Those numbers are NOT per-source; they belong to the shared
odp.ingest.raw stream / odp-store consumer group / odp_dlq table, so they are
reported as a single OdpSystemState, not folded into SourceMeasurement.

Design decision (do not re-litigate without updating the architecture doc):
aggregation happens HERE, in the Python control plane — not by adding a
/metrics endpoint to odp-ingest (Rust). odp-ingest's job is ingest/Redis only;
it must not grow a Postgres connection just to expose a dlq_count.
"""
