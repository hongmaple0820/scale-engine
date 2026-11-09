# Dashboard network exposure and security

SCALE Engine Dashboard binds to \`127.0.0.1\` by default. Loopback mode is
intended for a trusted local operator on the same machine.

## Non-loopback binding

Binding to \`0.0.0.0\`, a LAN address, or another non-loopback interface is
rejected unless \`SCALE_DASHBOARD_TOKEN\` is configured. The token must contain
at least 32 characters. Generate it with a cryptographically secure random
generator and keep it out of source control, shell history, logs, and support
bundles.

Every non-loopback bind also requires `SCALE_DASHBOARD_ALLOWED_HOSTS`, a comma-separated list of exact hostnames or IP addresses expected in the HTTP Host header. This prevents arbitrary Host values and DNS-rebinding hostnames from being treated as valid local Dashboard hosts. Do not use wildcards.\n\nEvery request to a token-protected Dashboard must include an
\`Authorization: Bearer <token>\` header. When using a reverse proxy, configure
it to inject this header upstream, keep the Dashboard port firewalled from
direct client access, and terminate TLS at the proxy. Do not expose the token
to browser JavaScript or place it in a URL.

## Browser request boundary

The Dashboard accepts browser requests only from the request's own origin or
an exact origin listed in \`SCALE_DASHBOARD_ALLOWED_ORIGINS\` (comma-separated
HTTP(S) origins). Cross-origin requests outside this allowlist are rejected,
including preflight requests. Only add origins controlled by the same operator.

## Mutation audit

API mutations (POST, PUT, PATCH, DELETE) are recorded in
\`.scale/audit/dashboard-security.jsonl\`. Records contain method, path, origin,
actor class, timestamp, request ID, and response status. Request bodies, bearer
tokens, and credential values are never written to this log. If the audit log
cannot record the start of a mutation, that mutation is rejected before its
handler runs.

## Current authorization model and limits

The configured bearer token grants one operator-level permission set; this is
not a multi-user role/permission system. Loopback mode without a token remains
a local-trust mode and does not authenticate individual local processes.
Origin checks are a browser CSRF boundary, not a substitute for authentication.
For remote access, use the token together with a TLS reverse proxy and firewall.
Do not expose the Dashboard directly to the public internet.
