# The control loop runs as a dedicated background cycle, not on UI polling and not inside the collection scheduler

Before PR-Control-4, control decisions only happened when the frontend polled `GET /sources/{id}/control-state` — close the UI and the loop stops, which contradicts the point of Automatic Mode (the system heals while nobody watches). The actuator is therefore driven by a dedicated asyncio background task started in the app lifespan: on a fixed configurable period it measures every source, decides, executes when gates allow, and also runs the pending-outcome judgment (previously lazy, so verdicts never landed unless someone requested the report). Frontend polling degrades to a pure read.

We deliberately did not hang this on the existing collection scheduler: the controller and the plant it supervises must not share a scheduling domain, or a fault that stalls collection scheduling also stalls the mechanism meant to detect and react to it.
