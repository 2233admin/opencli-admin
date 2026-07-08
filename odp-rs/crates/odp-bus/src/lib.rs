//! Redis Streams adapter for ODP data plane.

pub mod redis_streams;

pub use redis_streams::{BusConfig, RedisBus, StreamNames};