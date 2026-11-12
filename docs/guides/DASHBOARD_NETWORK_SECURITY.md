# Dashboard network exposure and security

SCALE Engine Dashboard binds to `127.0.0.1` by default. Loopback mode is
intended for a trusted local operator on the same machine.

## Non-loopback binding

Binding to `0.0.0.0`, a LAN address, or another non-loopback interface is
rejected unless either `SCALE_DASHBOARD_TOKEN` or at least one valid
`SCALE_DASHBOARD_SCOPED_TOKENS` entry is configured. Every token must contain
at least 32 characters. Generate tokens with a cryptographically secure random
generator and keep them out of source control, shell history, logs, and support
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
`dashboard:admin`, `agent-control:read`, `agent-control:write`, `agent-control:admin`,
`integrations:read`, `integrations:write`, `integrations:admin`,
`bridge:read`, `bridge:write`, `bridge:admin`, `tasks:read`,
`tasks:write`, `tasks:admin`, `governance:read`, `governance:write`,
and `governance:admin`.
The legacy operator token and `dashboard:admin` scope bypass route scopes;
domain `*:admin` scopes include read/write access within that same domain, but
do not grant permissions in other domains. Other tokens are limited to the
exact route family and operation scope. Agent
model routing and local executor enablement require `agent-control:admin`;
cron execution requires `tasks:admin`; governance policy/configuration and
lesson approval/rejection require `governance:admin`. Sensitive integration
authorization/configuration, bridge registration/deletion, and Dashboard
restart/reload operations require their admin scope. Tokens are compared
without logging their values; audit records identify only the actor class.

## Browser request boundary

The Dashboard accepts browser requests only from the request's own origin or
an exact origin listed in `SCALE_DASHBOARD_ALLOWED_ORIGINS` (comma-separated
HTTP(S) origins). Cross-origin requests outside this allowlist are rejected,
including preflight requests. Only add origins controlled by the same operator.

## High-impact action confirmation

High-impact mutations require a short-lived, single-use confirmation bound to
the authenticated principal, exact HTTP method, and exact route. The Dashboard
Vue client handles this automatically: when a protected action receives HTTP
428, it requests a confirmation challenge, displays a confirmation dialog in
the selected UI language, and retries once only after the operator accepts.

Non-browser clients must use the same two-step protocol:

1. Send `POST /api/security/confirmations` with the same bearer credential
   used for the action and JSON body `{"method":"POST","path":"/api/v1/restart"}`.
2. Read the returned `confirmationToken` and send the intended request with
   `X-SCALE-DASHBOARD-CONFIRMATION: <confirmationToken>`.
3. Use the token within 60 seconds. It is invalid after one use and cannot be
   replayed by another principal, method, or route. Missing, expired, mismatched,
   or replayed tokens receive HTTP 428.

The protected set includes Dashboard restart/reload, Agent model routing and
local-executor enablement, cron execution, governance policy/configuration,
lesson approval, integration authorization/configuration/setup, bridge
registration/deletion, and capability mapping. The route matcher is explicit;
ordinary message sending and read-only operations do not trigger confirmation.

This is an explicit intent-confirmation step, not second-person approval or
identity proof. A stolen credential can still request and consume its own
challenge; use TLS, a firewall, scoped credentials, and operator controls.

## Mutation audit

All HTTP mutations (POST, PUT, PATCH, DELETE), including bridge routes outside
`/api/`, and sensitive reads under Agent Control, integrations, task, bridge,
event, and governance APIs are recorded in
`.scale/audit/dashboard-security.jsonl`. Records contain method, path, origin,
actor class, timestamp, request ID, and response status. Authentication, scope,
rate-limit, and confirmation denials are also recorded as `request.denied`
with a reason and HTTP status. Request bodies, bearer
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

The legacy configured bearer token grants the full operator permission set.
Scoped tokens provide least-privilege remote roles, but they do not authenticate
individual OS users. Loopback mode without either token configuration remains a
local-trust mode; configuring scoped tokens also enables bearer authentication
on loopback. Origin checks are a browser CSRF boundary, not a substitute for
authentication. For remote access, use a bearer token together with a TLS reverse
proxy and firewall. Do not expose the Dashboard directly to the public internet.

The Agent OS local API token (`SCALE_AGENT_OS_API_TOKEN`) is a separate
route-specific credential used by local bridge registration flows. Per-bridge
tokens authenticate bridge heartbeats/events; they are not Dashboard operator
tokens and do not grant Dashboard UI or Agent Control permissions.
