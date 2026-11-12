# Dashboard network exposure and security

SCALE Engine Dashboard binds to `127.0.0.1` by default. Loopback mode is
intended for a trusted local operator on the same machine.

## Non-loopback binding

Binding to `0.0.0.0`, a LAN address, or another non-loopback interface is
rejected unless `SCALE_DASHBOARD_TOKEN` is configured. The token must contain
at least 32 characters. Generate it with a cryptographically secure random
generator and keep it out of source control, shell history, logs, and support
bundles.

Every non-loopback bind also requires `SCALE_DASHBOARD_ALLOWED_HOSTS`, a
comma-separated list of exact hostnames or IP addresses expected in the HTTP
Host header. This prevents arbitrary Host values and DNS-rebinding hostnames
from being treated as valid local Dashboard hosts. Do not use wildcards.

A loopback bind exposed through a reverse proxy must also list the proxy's
public hostname in `SCALE_DASHBOARD_ALLOWED_HOSTS`; doing so requires the
operator token as well.

Every request to a token-protected Dashboard must include an
`Authorization: Bearer <token>` header. When using a reverse proxy, configure
it to inject this header upstream, keep the Dashboard port firewalled from
direct client access, and terminate TLS at the proxy. Do not expose the token
to browser JavaScript or place it in a URL.

## Scoped bearer tokens

The legacy `SCALE_DASHBOARD_TOKEN` remains a full operator/admin token for
backward compatibility. Additional least-privilege bearer tokens can be
configured with `SCALE_DASHBOARD_SCOPED_TOKENS` as a JSON array:

```json
[
  {
    "id": "viewer",
    "token": "<at-least-32-random-characters>",
    "scopes": ["dashboard:read", "integrations:read"]
  },
  {
    "id": "agent-operator",
    "token": "<a-different-at-least-32-character-token>",
    "scopes": ["dashboard:read", "agent-control:read", "agent-control:write"]
  }
]
```

Supported scopes are `dashboard:read`, `dashboard:write`,
`dashboard:admin`, `agent-control:read`, `agent-control:write`,
`integrations:read`, `integrations:write`, `integrations:admin`,
`bridge:read`, `bridge:write`, `bridge:admin`, `tasks:read`,
`tasks:write`, `governance:read`, and `governance:write`.
The admin token and `dashboard:admin` scope bypass route scopes; all other
tokens are limited to the exact route family and operation scope. Sensitive
integration authorization/configuration, bridge registration/deletion, and
Dashboard restart operations require their admin scope. Tokens are compared
without logging their values; audit records identify only the actor class.


## Browser request boundary

The Dashboard accepts browser requests only from the request's own origin or
an exact origin listed in `SCALE_DASHBOARD_ALLOWED_ORIGINS` (comma-separated
HTTP(S) origins). Cross-origin requests outside this allowlist are rejected,
including preflight requests. Only add origins controlled by the same operator.

## Mutation audit

All HTTP mutations (POST, PUT, PATCH, DELETE), including bridge routes outside
`/api/`, and sensitive reads under Agent Control, integrations, task, bridge,
event, and governance APIs are recorded in
`.scale/audit/dashboard-security.jsonl`. Records contain method, path, origin,
actor class, timestamp, request ID, and response status. Request bodies, bearer
tokens, and credential values are never written to this log. If the audit log
cannot record the start of an audited request, that request is rejected before
its handler runs.

Dashboard requests also use process-local fixed-window rate limits per caller
credential/origin and route: unauthenticated remote requests are limited to 10
attempts per minute, mutations to 60 requests per minute, and reads to 300
requests per minute. Excess requests receive HTTP 429 and a `Retry-After`
header. These limits reset when the Dashboard process restarts; they are a
protective abuse-control layer, not a replacement for proxy-level limits.

## Current authorization model and limits

The configured bearer token grants one operator-level permission set; this is
not a multi-user role/permission system. Loopback mode without a token remains
a local-trust mode and does not authenticate individual local processes.
Origin checks are a browser CSRF boundary, not a substitute for authentication.
For remote access, use the token together with a TLS reverse proxy and firewall.
Do not expose the Dashboard directly to the public internet.
