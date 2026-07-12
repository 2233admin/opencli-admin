# Use outbound Worker connections for scheduling

Workers actively establish an authenticated HTTPS or WebSocket connection to the Control Plane to register, report health and verified capabilities, lease tasks, and return results. WireGuard, Tailscale, or another private network may provide connectivity but is not the platform identity or scheduling protocol. SSH remains an installation, maintenance, and governed Control Session mechanism rather than the normal job transport.
