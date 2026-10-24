// SCALE Engine — MCP stdio bridge for DSH
// Wraps ScaleMCPServer behind @modelcontextprotocol/sdk StdioServerTransport
// (not hand-rolled framing, which would underestimate MCP protocol negotiation — plan §6 T0)

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ScaleMCPServer, type MCPRequest, type MCPResponse } from './mcp.js'

const SHELL_TOOLS = new Set(['shell_run', 'shell_plan'])

type ShellEnv = { SCALE_MCP_EXPOSE_SHELL?: string | undefined }

/**
 * Default: omit shell_run / shell_plan so models cannot bypass Shield via
 * mcp__scale__shell_run when T1's pwsh mapping is in place (§6 T0 item 2).
 * Set SCALE_MCP_EXPOSE_SHELL=1 to restore the full tool surface.
 * Filtering lives in this DSH-only wrapper, never in getTools(), so other
 * MCP clients (Claude Code, Cursor, …) keep seeing the full list.
 */
export function shouldFilterShellTools(env: ShellEnv = process.env): boolean {
  return !env.SCALE_MCP_EXPOSE_SHELL
}

/** Apply the shell-tool filter to a tools/list response object (mutates result.tools). */
export function filterShellTools(
  result: { tools?: Array<{ name: string }> },
  env: ShellEnv = process.env,
): number {
  if (!shouldFilterShellTools(env) || !result.tools) return 0
  const before = result.tools.length
  result.tools = result.tools.filter((t) => !SHELL_TOOLS.has(t.name))
  return before - result.tools.length
}

async function main(): Promise<void> {
  const scaleDir = process.env.SCALE_DIR || '.scale'
  const server = new ScaleMCPServer(scaleDir)
  const transport = new StdioServerTransport()

  transport.onmessage = async (msg) => {
    // Only dispatch JSON-RPC requests (have method + id); skip notifications and responses
    if (!('method' in msg) || !('id' in msg)) return

    const request = msg as unknown as MCPRequest
    const response: MCPResponse = await server.handleRequest(request)

    if (request.method === 'tools/list' && response.result) {
      const result = response.result as { tools?: Array<{ name: string }> }
      const removed = filterShellTools(result)
      if (removed > 0) {
        process.stderr.write(
          `[scale-mcp-stdio] shell tools filtered (${removed} removed). ` +
            `Set SCALE_MCP_EXPOSE_SHELL=1 to expose them.\n`,
        )
      }
    }

    await transport.send(response as Parameters<typeof transport.send>[0])
  }

  transport.onerror = (err) => {
    process.stderr.write(`[scale-mcp-stdio] transport error: ${err.message}\n`)
  }

  transport.onclose = () => {
    // clean shutdown — no resources to release beyond what StdioServerTransport handles
  }

  await transport.start()
  process.stderr.write(`[scale-mcp-stdio] listening (scale dir: ${scaleDir})\n`)
}

void main()
