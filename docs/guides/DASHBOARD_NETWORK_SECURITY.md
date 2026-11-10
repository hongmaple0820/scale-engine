# Dashboard network exposure

SCALE Engine Dashboard binds to `127.0.0.1` by default. This keeps the dashboard
and its project-management APIs reachable only from the local machine unless
the operator explicitly changes the bind host.

To select a different interface, set `SCALE_DASHBOARD_HOST` before starting the
dashboard. Binding to `0.0.0.0` or another non-loopback interface exposes the
dashboard to other machines that can reach that interface.

**Do not expose the Dashboard directly to the public internet.** The current
Dashboard API is designed for local use; a non-loopback bind must be placed
behind a separately configured authentication and TLS boundary, restricted
to a trusted network, and protected by firewall rules. A custom bind host is
not itself an authentication mechanism.

The launch URL is a convenience address, not an access-control boundary.
