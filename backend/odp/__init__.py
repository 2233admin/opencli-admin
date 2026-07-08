"""Typed mirror of the Rust ODP contract (``odp-rs/crates/odp-contracts``).

The forward path to the Rust ingest service exchanges a fixed wire shape. This
package pins that shape in one place (:mod:`backend.odp.schemas`) and the single
mapper that produces it (:mod:`backend.odp.mapper`), so the legacy forwarder and
the future ``OdpSink`` cannot drift apart.
"""
