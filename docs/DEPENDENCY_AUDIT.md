# Dependency Audit

Dependency Audit is the G7 dependency sub-gate for SCALE Engine.
It adds supply-chain checks without introducing a separate gate number such as `G6.8`.

## Scope

The auditor is intentionally bounded:

- reads `package-lock.json`
- audits direct dependencies by default
- supports `--changed-packages` for lockfile-diff workflows
- scans only selected package roots under `node_modules`
- caps package count and files per package
- does not contact the registry by default
- does not run install scripts

This keeps local verification usable while still catching high-risk dependency behavior.

## Commands

```bash
scale dependency audit
scale dependency audit --json
scale dependency audit --mode strict
scale dependency audit --changed-packages left-pad,@scope/tool --json
```

The command exits non-zero when the active mode has blocking findings.

## Verification Command Safety

SCALE verification commands are security-sensitive because they are often run in CI.
The core verification paths (`verify-task`, phase verification, workflow eval attempts, and gate commands) execute configured commands without shell expansion by default.

Allowed by default:

```bash
npm run build
npm test -- --runInBand
node scripts/check.js --changed
```

Blocked by default:

```bash
npm test && curl https://example.com
node scripts/check.js | tee out.txt
```

Shell metacharacters such as `&&`, `|`, `;`, `<`, `>`, backticks, and unquoted `$` are rejected before execution. Use package scripts or checked-in helper scripts for composed commands. `SCALE_ALLOW_SHELL_COMMANDS=1` re-enables shell execution only for trusted local runs and must not be enabled for untrusted PR or user-controlled CI inputs. `workflow eval` attempts are stricter: they always keep shell expansion disabled, even when the environment override is set. Installed skill invocations are stricter as well: parse failures are rejected instead of retried with `shell: true`, browser-style builtins such as `web-access` curl calls and `playwright` CLI launches pass user-controlled values as argv entries, and document-processing builtins no longer embed user file paths into inline `python -c` code.

## G7 Integration

`SecurityGate` now emits two first-class evidence sources:

- `built-in-security-scan`: source code security scan
- `dependency-audit`: dependency supply-chain scan

Both remain under `G7 Security`.

## Policy

Policy lives at `.scale/security/dependency-policy.json`:

```json
{
  "version": 1,
  "mode": "compatibility",
  "maxPackages": 50,
  "maxPackageFiles": 25,
  "allowPackages": [],
  "baselineFindings": []
}
```

Modes:

- `compatibility`: blocks `CRITICAL`
- `strict`: blocks `CRITICAL` and `HIGH`
- `offline`: keeps local-only behavior; current offline findings follow compatibility blocking

Use `baselineFindings` for accepted legacy dependency risk:

```json
{
  "baselineFindings": [
    {
      "packageName": "legacy-tool",
      "version": "1.2.3",
      "ruleId": "dependency.install-script",
      "reason": "Pinned and reviewed during migration window."
    }
  ]
}
```

Prefer a baseline over `allowPackages` when only one finding is accepted. `allowPackages` suppresses all findings for that package.

## Current Findings

The first implementation detects:

- install lifecycle scripts
- executable bin scripts
- deprecated packages from lockfile metadata
- built-in ownership/provenance watchlist matches
- dynamic code execution: `eval`, `new Function`
- shell execution patterns
- suspicious network access patterns

The built-in ownership/provenance watchlist currently blocks exact versions that were flagged by external package behavior analysis:

- `content-type@2.0.0`
- `type-is@2.1.0`
- `type-js@2.1.0` (kept as a defensive alias for reports that use this package name)

Future network-backed checks can add npm registry metadata and `npm audit --json` ingestion, but they should stay optional and evidence-backed.
