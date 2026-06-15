# Code Intelligence

SCALE uses an adapter-first code intelligence layer. It can consume the upstream [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) CLI when it is installed and the project has a local `.codegraph/` index, detect optional external CLIs such as [GitNexus](https://github.com/abhigyanpatwari/GitNexus) and code-review-graph, read graph artifacts such as Graphify outputs, and fall back to a scoped internal source scan when no provider is available.

The goal is not to replace IDE indexing. The goal is to make exploration measurable:

- which provider answered the query
- whether fallback was used
- which files are likely relevant
- how many file reads were avoided
- what confidence the result has

## Quick Start

Optional upstream install:

```bash
npx @colbymchenry/codegraph
# or
npm i -g @colbymchenry/codegraph
codegraph init -i
```

Governed SCALE setup:

```bash
scale setup --pack knowledge
scale codegraph status --json
```

For Graphify, prefer isolated tool installation:

```bash
uv tool install graphify
graphify install --platform codex
graphify query "auth service" --graph graphify-out/graph.json
```

Run a real large-project rehearsal before treating Graphify as an operational knowledge provider:

```bash
npm run smoke:graphify -- --large-project /path/to/large-project
node scripts/workflow/provider-rehearsal.mjs --skip-gbrain --require-graphify --large-project /path/to/large-project
```

The rehearsal executes `graphify update <project> --no-cluster` by default so graph generation stays AST/Python based and does not call a model. It locates the generated `graph.json`, parses graph stats, and runs `graphify query`. Use `--semantic-extract` only when semantic LLM extraction is explicitly allowed. Do not commit generated `graphify-out/` artifacts by default; commit only reviewed knowledge summaries, docs, or rules derived from the graph.

For GitNexus, keep it as an explicit optional provider because the npm package is licensed under PolyForm-Noncommercial-1.0.0 and may run install/build scripts for native grammar support:

```bash
scale bootstrap deps --pack external-cli --include gitnexus --json
npm install -g gitnexus
gitnexus analyze --index-only
gitnexus status
gitnexus mcp
```

If global install is not allowed, the upstream skill path uses `npx gitnexus@latest analyze --index-only` to generate a project-local `.gitnexus/` index and runner. Do not treat GitNexus as a required SCALE dependency without a license and installation review for the target project.

Create the optional provider configuration:

```bash
scale codegraph init
```

Inspect provider availability:

```bash
scale codegraph status
scale codegraph status --json
scale tool doctor --tools codegraph,graphify,gitnexus --json
```

Query code intelligence:

```bash
scale codegraph query "UserService.create"
scale codegraph impact --symbol UserService.create
scale codegraph context --symbol UserService.create --budget 2000
scale codegraph roi --symbol UserService.create
```

## Configuration

The configuration file lives at:

```text
.scale/code-intelligence.json
```

Default shape:

```json
{
  "version": "1.0",
  "providers": [
    {
      "id": "codegraph",
      "type": "external-cli",
      "enabled": true,
      "command": "codegraph",
      "capabilities": ["symbols", "callers", "callees", "impact", "context", "summary", "module-map"],
      "source": "https://github.com/colbymchenry/codegraph",
      "installHint": "npx @colbymchenry/codegraph or npm i -g @colbymchenry/codegraph",
      "projectInitHint": "codegraph init -i",
      "serveCommand": "codegraph serve --mcp"
    },
    {
      "id": "graphify",
      "type": "artifact",
      "enabled": true,
      "manifest": "graphify-out/graph.json",
      "capabilities": ["symbols", "callers", "callees", "impact", "context", "summary", "module-map"],
      "source": "https://github.com/safishamsi/graphify",
      "installHint": "uv tool install graphify && graphify install --platform codex"
    },
    {
      "id": "code-review-graph",
      "type": "external-cli",
      "enabled": true,
      "command": "code-review-graph",
      "capabilities": ["symbols", "callers", "callees", "impact", "context", "summary", "module-map"],
      "source": "https://github.com/tirth8205/code-review-graph",
      "installHint": "pip install code-review-graph",
      "projectInitHint": "code-review-graph build",
      "serveCommand": "code-review-graph serve"
    },
    {
      "id": "gitnexus",
      "type": "external-cli",
      "enabled": true,
      "command": "gitnexus",
      "capabilities": ["symbols", "callers", "callees", "impact", "context", "summary", "module-map"],
      "source": "https://github.com/abhigyanpatwari/GitNexus",
      "installHint": "npm install -g gitnexus or npx gitnexus@latest analyze --index-only",
      "projectInitHint": "gitnexus analyze --index-only",
      "serveCommand": "gitnexus mcp"
    }
  ],
  "fallback": {
    "enabled": true,
    "tools": ["internal-scan", "rg", "read"]
  }
}
```

## Provider Types

| Type | Use |
| --- | --- |
| `external-cli` | Detects an installed external code graph command. For `codegraph`, SCALE consumes the official JSON output from `codegraph query --json` and `codegraph context --format json` when `.codegraph/` exists. Other external CLIs such as GitNexus and code-review-graph stay optional unless a command adapter is explicitly wired. |
| `artifact` | Reads a local graph manifest or report file. JSON manifests can provide symbol impact data. |
| fallback | Uses a bounded internal source scan when providers are unavailable or return no hits. |

## JSON Artifact Provider

Artifact providers can point at a JSON manifest:

```json
{
  "symbols": [
    {
      "name": "UserService.create",
      "file": "src/user.ts",
      "callers": ["src/api.ts"],
      "callees": ["src/db.ts"]
    }
  ],
  "files": [
    {
      "path": "src/user.ts",
      "symbols": ["UserService.create"]
    }
  ]
}
```

This allows SCALE to answer impact queries without reading the whole repository.

## ROI Metrics

Code intelligence reports include:

| Metric | Meaning |
| --- | --- |
| `graphHits` | Number of hits from graph providers. |
| `fallbackCount` | Whether fallback was needed. |
| `baselineFileReads` | Estimated broad exploration file reads. |
| `recommendedFileReads` | Scoped file reads recommended by the query result. |
| `fileReadsSaved` | Estimated avoided reads. |
| `toolCallsSaved` | Estimated avoided exploration tool calls. |

These numbers are deliberately conservative. They are a local signal for whether graph-assisted exploration is worth keeping default for a task class.

## Governance ROI

`scale governance roi` can include code intelligence:

```bash
scale governance roi --symbol UserService.create
scale governance roi --code-query createUser
```

When a graph provider answers, the module is reported as measured evidence. When fallback is used, the module is reported as estimated and needs more evidence before becoming a stronger default.

## Policy

- SCALE must run when no code graph provider is installed.
- Missing providers must produce explicit fallback, not silent success.
- External tools are installed only through explicit user intent such as `scale setup --pack knowledge --apply --yes`, then verified with `scale setup --verify --pack knowledge --json`.
- When CodeGraph is installed and the project is initialized, SCALE should prefer the upstream JSON query/context surfaces before falling back to raw file scans.
- Graphify is treated as an artifact provider. CLI installation is not enough; `graphify-out/graph.json` must exist before graph-backed knowledge recall can use it.
- GitNexus is treated as an optional external provider. CLI installation is not enough; `.gitnexus/` should exist before relying on GitNexus MCP or direct query/impact tools.
- Because GitNexus is published under PolyForm-Noncommercial-1.0.0, do not make it a default hard dependency for commercial use without explicit license review.
- Source files are read only through a bounded fallback scan.
- Large generated graph outputs should stay outside default prompt context; use summaries and file paths.
