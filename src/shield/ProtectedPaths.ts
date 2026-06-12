// SCALE Shield — Protected Paths & Command Blocklist
// 对齐 agent-hooks-in-depth: protect-paths.py + command-policy.py
// 阻断 .scale/ 修改 + 40+ 危险命令模式

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, normalize } from 'node:path'
import type { ShieldInput, ShieldDecision } from './ShieldProtocol.js'
import { logger } from '../core/logger.js'

// ---------------------------------------------------------------------------
// Protected path patterns — any Write/Edit/Bash targeting these is blocked
// ---------------------------------------------------------------------------

export interface ProtectedPathRule {
  glob: string         // minimatch-style glob
  reason: string
  allowReads: boolean  // reads (Read/Grep/Glob) are always allowed
}

const PROTECTED_PATHS: ProtectedPathRule[] = [
  { glob: '.scale/**', reason: '.scale/ governance infrastructure — run scale shield compile to apply', allowReads: true },
  { glob: '.hook-state/**', reason: 'hook state files — managed by Shield engine', allowReads: true },
  { glob: '.scale/policy.yaml', reason: 'governance policy — must be reviewed before modification', allowReads: true },
  { glob: 'SCALE_POLICY.md', reason: 'orchestration policy — managed by governance lead', allowReads: true },
  { glob: '.claude/settings.json', reason: 'Claude Code settings — managed by scale shield compile', allowReads: true },
  { glob: '.codex/hooks.json', reason: 'Codex hooks config — managed by scale shield compile', allowReads: true },
  { glob: '.cursor/hooks.json', reason: 'Cursor hooks config — managed by scale shield compile', allowReads: true },
  { glob: '.env', reason: 'environment secrets — never write to .env files', allowReads: false },
  { glob: '.env.*', reason: 'environment secrets — never write to .env files', allowReads: false },
  { glob: '**/.git/config', reason: 'git config — potential credential tampering', allowReads: false },
  { glob: '**/credentials*', reason: 'credential files', allowReads: false },
  { glob: '**/*.pem', reason: 'private key files', allowReads: false },
  { glob: '**/*-key.json', reason: 'service account key files', allowReads: false },
]

// ---------------------------------------------------------------------------
// Dangerous command patterns — Bash tool input is matched against these
// ---------------------------------------------------------------------------

export interface CommandBlockRule {
  pattern: RegExp
  reason: string
  severity: 'block' | 'warn'
  category: 'destructive' | 'data-loss' | 'security' | 'governance-bypass'
}

const COMMAND_BLOCKLIST: CommandBlockRule[] = [
  // === Destructive operations ===
  { pattern: /\brm\s+-rf\b/, reason: 'Recursive force delete (rm -rf) — data loss risk', severity: 'block', category: 'destructive' },
  { pattern: /\brm\s+-r\b/, reason: 'Recursive delete (rm -r)', severity: 'block', category: 'destructive' },
  { pattern: /\brmdir\b/, reason: 'Remove directory', severity: 'warn', category: 'destructive' },
  { pattern: /git\s+clean\s+-[fd]+/, reason: 'Git clean with force — removes untracked files', severity: 'block', category: 'destructive' },
  { pattern: /git\s+reset\s+--hard/, reason: 'Git hard reset — destroys uncommitted work', severity: 'block', category: 'destructive' },
  { pattern: /git\s+push\s+--force/, reason: 'Git force push — overwrites remote history', severity: 'block', category: 'destructive' },
  { pattern: /git\s+push\s+-f\b/, reason: 'Git force push (short flag)', severity: 'block', category: 'destructive' },
  { pattern: /git\s+checkout\s+--\s/, reason: 'Git checkout — discards working changes', severity: 'warn', category: 'destructive' },
  { pattern: /git\s+stash\s+drop/, reason: 'Git stash drop — permanent stash deletion', severity: 'warn', category: 'destructive' },
  { pattern: /git\s+branch\s+-D\b/, reason: 'Git branch force delete', severity: 'block', category: 'destructive' },
  { pattern: /chmod\s+777\b/, reason: 'World-writable permissions (chmod 777)', severity: 'block', category: 'security' },
  { pattern: /chmod\s+-R\s+777/, reason: 'Recursive world-writable (chmod -R 777)', severity: 'block', category: 'security' },
  { pattern: /chown\s+root/, reason: 'Change ownership to root', severity: 'warn', category: 'security' },
  { pattern: /\bdocker\s+rm\s+-f\b/, reason: 'Docker force remove container', severity: 'warn', category: 'destructive' },
  { pattern: /\bdocker\s+system\s+prune\b/, reason: 'Docker system prune — removes all unused data', severity: 'block', category: 'destructive' },
  { pattern: /\bkubectl\s+delete\b/, reason: 'Kubernetes resource deletion', severity: 'block', category: 'destructive' },
  { pattern: /\bDROP\s+TABLE\b/i, reason: 'SQL DROP TABLE — data loss', severity: 'block', category: 'data-loss' },
  { pattern: /\bDROP\s+DATABASE\b/i, reason: 'SQL DROP DATABASE — catastrophic data loss', severity: 'block', category: 'data-loss' },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, reason: 'SQL TRUNCATE TABLE — data loss', severity: 'block', category: 'data-loss' },
  { pattern: /\bDELETE\s+FROM\b(?!.*\bWHERE\b)/i, reason: 'SQL DELETE without WHERE — full table deletion', severity: 'block', category: 'data-loss' },

  // === Security: secret exposure ===
  { pattern: /\bcat\s+.*\.env\b/, reason: 'Reading .env file — potential secret exposure in output', severity: 'block', category: 'security' },
  { pattern: /\becho\s+.*\$?API[_-]?KEY\b/i, reason: 'Printing API key — secret exposure', severity: 'block', category: 'security' },
  { pattern: /\becho\s+.*\$?TOKEN\b/i, reason: 'Printing token — secret exposure', severity: 'block', category: 'security' },
  { pattern: /\becho\s+.*\$?SECRET\b/i, reason: 'Printing secret — credential leak', severity: 'block', category: 'security' },
  { pattern: /\becho\s+.*\$?PASSWORD\b/i, reason: 'Printing password — credential leak', severity: 'block', category: 'security' },
  { pattern: /\bcurl.*\|\s*bash\b/, reason: 'curl-pipe-bash — remote code execution risk', severity: 'block', category: 'security' },
  { pattern: /\bwget.*\|\s*bash\b/, reason: 'wget-pipe-bash — remote code execution risk', severity: 'block', category: 'security' },
  { pattern: /\beval\s+/i, reason: 'eval — code injection risk', severity: 'block', category: 'security' },

  // === Governance bypass ===
  { pattern: /--no-verify\b/, reason: 'Skipping git hooks (--no-verify)', severity: 'block', category: 'governance-bypass' },
  { pattern: /--no-gpg-sign\b/, reason: 'Skipping GPG signing', severity: 'warn', category: 'governance-bypass' },
  { pattern: /\.claude\b.*\brm\b/, reason: 'Modifying .claude directory — potential hook bypass', severity: 'block', category: 'governance-bypass' },
  { pattern: /\.codex\b.*\brm\b/, reason: 'Modifying .codex directory — potential hook bypass', severity: 'block', category: 'governance-bypass' },
  { pattern: /SKIP_HOOKS/i, reason: 'Environment variable to skip hooks — governance bypass', severity: 'block', category: 'governance-bypass' },
  { pattern: /DISABLE_OMC/i, reason: 'OMC disable flag — governance bypass', severity: 'block', category: 'governance-bypass' },
  { pattern: /dang[eo]rously/i, reason: 'Dangerous mode flag — safety bypass', severity: 'block', category: 'governance-bypass' },
  { pattern: /bypass/i, reason: 'Bypass flag detected', severity: 'warn', category: 'governance-bypass' },
  { pattern: /allowDangerously/i, reason: 'allowDangerously flag — sandbox escape', severity: 'block', category: 'governance-bypass' },
]

// ---------------------------------------------------------------------------
// Check functions
// ---------------------------------------------------------------------------

export interface PathCheckResult {
  blocked: boolean
  matchedRule?: ProtectedPathRule
  targetPath: string
}

/**
 * Check if a file write target is a protected path.
 * Returns { blocked: true } if the path matches any protected glob.
 */
export function checkProtectedPath(
  targetPath: string,
  cwd: string = process.cwd(),
  toolName?: string,
): PathCheckResult {
  // Reads are always allowed
  if (toolName && ['Read', 'Grep', 'Glob'].includes(toolName)) {
    return { blocked: false, targetPath }
  }

  const normalized = normalize(targetPath)
  const resolved = resolve(cwd, normalized)

  for (const rule of PROTECTED_PATHS) {
    if (matchGlob(normalized, rule.glob) || matchGlob(resolved, rule.glob)) {
      return { blocked: true, matchedRule: rule, targetPath: normalized }
    }
  }

  return { blocked: false, targetPath: normalized }
}

/**
 * Check if a command contains any blocked patterns.
 * Returns list of matched rules.
 */
export function checkCommand(command: string): CommandBlockRule[] {
  const matches: CommandBlockRule[] = []
  for (const rule of COMMAND_BLOCKLIST) {
    if (rule.pattern.test(command)) {
      matches.push(rule)
    }
  }
  return matches
}

/**
 * Full pre-flight check for a tool input.
 * Returns allow/block decision.
 */
export function checkToolInput(input: ShieldInput): ShieldDecision {
  const cwd = input.cwd ?? process.cwd()
  const toolName = input.tool_name
  const toolInput = input.tool_input ?? {}

  // 1. Check protected paths for Write/Edit tools
  if (toolName === 'Write' || toolName === 'Edit') {
    const filePath = (toolInput.file_path as string) ?? (toolInput.path as string) ?? ''
    if (filePath) {
      const pathResult = checkProtectedPath(filePath, cwd, toolName)
      if (pathResult.blocked) {
        return {
          decision: 'block',
          reason: `[Protected Path] ${pathResult.matchedRule?.reason} — target: ${pathResult.targetPath}`,
          suggestion: `Run 'scale shield compile' to update policy, or request governance lead approval`,
          evidence: {
            policy_rule: 'protected-path',
            matched_pattern: pathResult.matchedRule?.glob,
            timestamp: new Date().toISOString(),
          },
        }
      }
    }
  }

  // 2. Check command blocklist for Bash tools
  if (toolName === 'Bash') {
    const command = String(toolInput.command ?? '')
    const matches = checkCommand(command)
    if (matches.length > 0) {
      const blocking = matches.filter(m => m.severity === 'block')
      if (blocking.length > 0) {
        const reasons = blocking.map(m => `[${m.category}] ${m.reason}`).join('; ')
        return {
          decision: 'block',
          reason: reasons,
          suggestion: 'If this command is intentional, request governance lead approval',
          evidence: {
            policy_rule: 'command-blocklist',
            matched_pattern: blocking[0].pattern.source,
            timestamp: new Date().toISOString(),
          },
        }
      }
    }
  }

  return { decision: 'allow', reason: 'OK', evidence: { policy_rule: 'default-allow', timestamp: new Date().toISOString() } }
}

/**
 * Verify .scale/ directory integrity.
 */
export function verifyScaleIntegrity(cwd: string): { intact: boolean; missing: string[] } {
  const required = [
    '.scale/workspace.json',
    '.scale/policy.yaml',
  ]
  const missing = required.filter(f => !existsSync(join(cwd, f)))
  return { intact: missing.length === 0, missing }
}

// ---------------------------------------------------------------------------
// Simple glob matching (handles **, *, explicit paths)
// ---------------------------------------------------------------------------

function matchGlob(target: string, glob: string): boolean {
  // Normalize separators
  const t = target.replace(/\\/g, '/')
  const g = glob.replace(/\\/g, '/')

  // Exact match
  if (t === g || t.endsWith('/' + g) || t === g.replace(/^\*\*\//, '')) return true

  // Convert glob to regex
  const regexStr = g
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')

  try {
    const re = new RegExp(`^${regexStr}$|/${regexStr}$|^${regexStr}/`)
    return re.test(t)
  } catch (err) {
    logger.debug({ err, glob }, 'Unable to compile protected path glob')
    return false
  }
}
