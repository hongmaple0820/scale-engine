// SCALE Shield — Policy Compiler
// 对齐 agent-hooks-in-depth: YAML 声明式策略 → 运行时 hook 脚本
// 输出 JS hook 脚本注入到 Claude/Codex/Cursor settings.json

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { logger } from '../core/logger.js'

// ---------------------------------------------------------------------------
// Policy YAML types
// ---------------------------------------------------------------------------

export interface ShieldPolicy {
  version: number
  rules: ShieldPolicyRule[]
  settings?: {
    blockMode?: 'strict' | 'warn'
    hookStateDir?: string
    notifyOnBlock?: boolean
  }
}

export interface ShieldPolicyRule {
  id: string
  description: string
  hookType: 'PreToolUse' | 'PostToolUse' | 'Stop' | 'SessionStart'
  matcher: string // tool name matcher (regex), '' = match all
  action: 'block' | 'warn' | 'allow'
  conditions: ShieldCondition[]
}

export interface ShieldCondition {
  type: 'protected_path' | 'dangerous_command' | 'gate_required' | 'secret_pattern' | 'file_size' | 'dirty_tree' | 'custom'
  pattern?: string
  value?: string | number
  message: string
}

/**
 * Default allowlist for the dirty_tree Stop check: tool-generated artifacts that
 * routinely stay untracked and must not keep a session from ending cleanly.
 * Matched against each `git status --porcelain` entry path.
 */
export const DEFAULT_DIRTY_TREE_ALLOW_PATTERN =
  '^(\\.workbuddy(/|-)|\\.workbuddy-ai/|output/|tmp/|\\.scale-test-session/|\\.hook-state/|\\.planning/cache/)|\\.timestamp-\\d+-[0-9a-f]+\\.mjs$'

export interface DirtyTreeEvaluation {
  dirty: boolean
  /** Entry paths that count as uncommitted work. */
  entries: string[]
  /** Entry paths filtered out by the allowlist. */
  allowed: string[]
  reason: string
}

/**
 * Shared dirty-worktree evaluation for the Stop hook and `scale shield test`.
 * Returns the non-allowlisted porcelain entries; never throws (a non-repository
 * directory reports clean so the check fails open).
 */
export function evaluateDirtyTree(cwd: string, allowPattern: string = DEFAULT_DIRTY_TREE_ALLOW_PATTERN): DirtyTreeEvaluation {
  let raw = ''
  try {
    raw = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return { dirty: false, entries: [], allowed: [], reason: 'not a git worktree; dirty-tree check skipped' }
  }
  let allowRe: RegExp | undefined
  try {
    allowRe = new RegExp(allowPattern)
  } catch {
    allowRe = undefined
  }
  const entries: string[] = []
  const allowed: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    const entryPath = line.slice(3)
    if (allowRe && allowRe.test(entryPath)) allowed.push(entryPath)
    else entries.push(entryPath)
  }
  return {
    dirty: entries.length > 0,
    entries,
    allowed,
    reason: entries.length > 0
      ? `${entries.length} changed entr${entries.length === 1 ? 'y' : 'ies'} (e.g. ${entries[0]})`
      : 'worktree is clean after allowlist filtering',
  }
}

// ---------------------------------------------------------------------------
// Compiled hook output
// ---------------------------------------------------------------------------

export interface CompiledHook {
  fileName: string
  hookType: string
  matcher: string
  scriptPath: string
  hash: string
}

export interface CompilerOutput {
  hooks: CompiledHook[]
  settingsPatches: {
    claude: string   // path to settings.json
    codex: string
    cursor: string
  }
  policyHash: string
}

// ---------------------------------------------------------------------------
// Default policy
// ---------------------------------------------------------------------------

const DEFAULT_POLICY: ShieldPolicy = {
  version: 1,
  rules: [
    {
      id: 'protect-scale-dir',
      description: 'Protect .scale/ governance infrastructure from unauthorized modification',
      hookType: 'PreToolUse',
      matcher: 'Write|Edit',
      action: 'block',
      conditions: [
        { type: 'protected_path', pattern: '.scale/', message: 'Modifying .scale/ governance files is blocked' },
      ],
    },
    {
      id: 'block-dangerous-commands',
      description: 'Block dangerous shell commands: rm -rf, DROP TABLE, force push, curl-pipe-bash',
      hookType: 'PreToolUse',
      matcher: 'Bash',
      action: 'block',
      conditions: [
        { type: 'dangerous_command', message: 'Dangerous command detected' },
      ],
    },
    {
      id: 'require-gate-quality',
      description: 'Block git commits without passing gate-quality checks',
      hookType: 'PreToolUse',
      matcher: 'Bash',
      action: 'block',
      conditions: [
        { type: 'gate_required', pattern: 'git commit', message: 'Gate quality must pass before commit' },
      ],
    },
    {
      id: 'block-secret-exposure',
      description: 'Block commands that may expose secrets (cat .env, echo $API_KEY)',
      hookType: 'PreToolUse',
      matcher: 'Bash',
      action: 'block',
      conditions: [
        { type: 'secret_pattern', message: 'Potential secret exposure detected' },
      ],
    },
    {
      id: 'prevent-hook-bypass',
      description: 'Block attempts to skip hooks or bypass governance',
      hookType: 'PreToolUse',
      matcher: 'Bash',
      action: 'block',
      conditions: [
        { type: 'custom', pattern: '(--no-verify|--no-gpg-sign|SKIP_HOOKS|bypass|dang[eo]rously)', message: 'Governance bypass attempt blocked' },
      ],
    },
    {
      id: 'require-clean-worktree',
      description: 'Warn on session stop when the worktree has uncommitted changes (allowlisted tool artifacts excluded)',
      hookType: 'Stop',
      matcher: '',
      action: 'warn',
      conditions: [
        { type: 'dirty_tree', pattern: DEFAULT_DIRTY_TREE_ALLOW_PATTERN, message: 'Uncommitted changes detected' },
      ],
    },
  ],
  settings: {
    blockMode: 'strict',
    hookStateDir: '.hook-state',
    notifyOnBlock: true,
  },
}

// ---------------------------------------------------------------------------
// PolicyCompiler
// ---------------------------------------------------------------------------

export class PolicyCompiler {
  /**
   * Load policy from .scale/policy.yaml. Returns default if file missing or invalid.
   */
  loadPolicy(projectDir: string): ShieldPolicy {
    const policyPath = join(projectDir, '.scale', 'policy.yaml')
    if (!existsSync(policyPath)) {
      logger.warn('No .scale/policy.yaml found, using default policy')
      return { ...DEFAULT_POLICY }
    }

    try {
      const raw = readFileSync(policyPath, 'utf-8')
      return this.parseYamlPolicy(raw)
    } catch (err) {
      logger.warn({ err }, 'Failed to read policy.yaml, using default policy')
      return { ...DEFAULT_POLICY }
    }
  }

  /**
   * Minimal YAML parser for policy frontmatter.
   * Handles the subset of YAML needed for policy rules.
   */
  parseYamlPolicy(raw: string): ShieldPolicy {
    const policy: ShieldPolicy = { version: 1, rules: [] }
    const lines = raw.split('\n')
    let currentRule: Partial<ShieldPolicyRule> | null = null
    let inRules = false
    let inConditions = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      // Top-level keys
      if (trimmed.startsWith('version:')) {
        policy.version = parseInt(trimmed.split(':')[1]?.trim() ?? '1', 10) || 1
        continue
      }
      if (trimmed.startsWith('blockMode:') || trimmed.startsWith('block_mode:')) {
        policy.settings ??= {}
        policy.settings.blockMode = trimmed.split(':')[1]?.trim() as 'strict' | 'warn' ?? 'strict'
        continue
      }
      if (trimmed === 'rules:') { inRules = true; continue }
      if (!inRules) continue

      // Rule entry
      if (trimmed.startsWith('- id:')) {
        if (currentRule && currentRule.id) {
          policy.rules.push(currentRule as ShieldPolicyRule)
        }
        currentRule = { id: trimmed.split(':')[1]?.trim() ?? '', conditions: [], description: '', hookType: 'PreToolUse', matcher: '', action: 'block' }
        inConditions = false
        continue
      }
      if (!currentRule) continue

      if (trimmed.startsWith('description:')) {
        currentRule.description = trimmed.split(':').slice(1).join(':').trim()
        continue
      }
      if (trimmed.startsWith('hookType:') || trimmed.startsWith('hook_type:')) {
        currentRule.hookType = trimmed.split(':')[1]?.trim() as ShieldPolicyRule['hookType'] ?? 'PreToolUse'
        continue
      }
      if (trimmed.startsWith('matcher:')) {
        currentRule.matcher = trimmed.split(':')[1]?.trim() ?? ''
        continue
      }
      if (trimmed.startsWith('action:')) {
        currentRule.action = trimmed.split(':')[1]?.trim() as ShieldPolicyRule['action'] ?? 'block'
        continue
      }
      if (trimmed === 'conditions:') { inConditions = true; continue }
      if (inConditions && trimmed.startsWith('- type:')) {
        const cond: ShieldCondition = {
          type: trimmed.split(':')[1]?.trim() as ShieldCondition['type'] ?? 'custom',
          message: '',
        }
        currentRule.conditions!.push(cond)
        continue
      }
      if (inConditions && currentRule.conditions?.length) {
        const condition = currentRule.conditions[currentRule.conditions.length - 1]
        if (trimmed.startsWith('pattern:')) {
          condition.pattern = trimmed.split(':').slice(1).join(':').trim()
          continue
        }
        if (trimmed.startsWith('message:')) {
          condition.message = trimmed.split(':').slice(1).join(':').trim()
          continue
        }
        if (trimmed.startsWith('value:')) {
          const rawValue = trimmed.split(':').slice(1).join(':').trim()
          const numberValue = Number(rawValue)
          condition.value = Number.isFinite(numberValue) && rawValue !== '' ? numberValue : rawValue
          continue
        }
      }
    }

    // Flush last rule
    if (currentRule && currentRule.id) {
      policy.rules.push(currentRule as ShieldPolicyRule)
    }

    // Fallback to default rules if parsing yielded nothing
    if (policy.rules.length === 0) {
      logger.warn('Policy YAML parsed but no rules found, using defaults')
      return { ...DEFAULT_POLICY, version: policy.version, settings: policy.settings }
    }

    return policy
  }

  /**
   * Compile policy into hook scripts.
   */
  compile(projectDir: string): CompilerOutput {
    const policy = this.loadPolicy(projectDir)
    const hooksDir = join(projectDir, '.claude', 'hooks')
    if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true })

    const policyHash = createHash('sha256')
      .update(JSON.stringify(policy))
      .digest('hex')
      .slice(0, 12)

    const compiled: CompiledHook[] = []

    for (const rule of policy.rules) {
      const hook = this.compileRule(rule, hooksDir, policyHash)
      compiled.push(hook)
      writeFileSync(hook.scriptPath, this.generateHookScript(rule, policy), 'utf-8')
    }

    // Always generate a combined pre-tool hook for runtime efficiency
    const combinedPath = join(hooksDir, 'shield-pre-tool.js')
    const combinedScript = this.generateCombinedPreToolScript(policy)
    writeFileSync(combinedPath, combinedScript, 'utf-8')

    compiled.push({
      fileName: 'shield-pre-tool.js',
      hookType: 'PreToolUse',
      matcher: '',
      scriptPath: combinedPath,
      hash: policyHash,
    })

    logger.info({ count: compiled.length, policyHash }, 'Shield policy compiled')

    return {
      hooks: compiled,
      settingsPatches: {
        claude: join(projectDir, '.claude', 'settings.json'),
        codex: join(projectDir, '.codex', 'hooks.json'),
        cursor: join(projectDir, '.cursor', 'hooks.json'),
      },
      policyHash,
    }
  }

  /**
   * Write hook registrations to settings.json files for each harness.
   */
  writeSettingsPatches(output: CompilerOutput): void {
    // Claude Code settings.json
    this.patchClaudeSettings(output)

    // Codex hooks.json
    this.patchHarnessSettings(output.settingsPatches.codex, output, 'codex')

    // Cursor hooks.json
    this.patchHarnessSettings(output.settingsPatches.cursor, output, 'cursor')
  }

  /**
   * Verify compiled hooks match current policy (anti-tamper check).
   */
  verify(projectDir: string): { valid: boolean; mismatches: string[] } {
    const policy = this.loadPolicy(projectDir)
    const hooksDir = join(projectDir, '.claude', 'hooks')
    const mismatches: string[] = []

    const expectedHash = createHash('sha256')
      .update(JSON.stringify(policy))
      .digest('hex')
      .slice(0, 12)

    // Check combined hook exists
    const combinedPath = join(hooksDir, 'shield-pre-tool.js')
    if (!existsSync(combinedPath)) {
      mismatches.push('shield-pre-tool.js missing — run scale shield compile')
    } else {
      const content = readFileSync(combinedPath, 'utf-8')
      if (!content.includes(expectedHash)) {
        mismatches.push(`shield-pre-tool.js hash mismatch (expected ${expectedHash}) — run scale shield compile`)
      }
    }

    return { valid: mismatches.length === 0, mismatches }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private compileRule(rule: ShieldPolicyRule, hooksDir: string, hash: string): CompiledHook {
    const fileName = `shield-${rule.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.js`
    return {
      fileName,
      hookType: rule.hookType,
      matcher: rule.matcher,
      scriptPath: join(hooksDir, fileName),
      hash,
    }
  }

  private generateHookScript(rule: ShieldPolicyRule, policy: ShieldPolicy): string {
    const conditions = rule.conditions.map(c => JSON.stringify(c)).join(',\n    ')
    // A rule-level warn action stays a warning even in strict mode; block mode only
    // hardens rules that are already blocking by default.
    const isStrict = policy.settings?.blockMode !== 'warn'
    const warnOnly = rule.action === 'warn' || !isStrict
    // The tail already prints the reason with the right prefix; block mode additionally
    // exits 2 so the harness treats it as a hard stop.
    const blockFn = warnOnly ? '' : 'process.exit(2)'
    const blockedPrefix = warnOnly ? '[SCALE SHIELD WARN] ' : '[SCALE SHIELD BLOCKED] '

    return `// SCALE Shield: ${rule.id}
// Auto-generated by scale shield compile — DO NOT EDIT MANUALLY
// Rule: ${rule.description}
// Matcher: ${rule.matcher || '(all)'} | Action: ${rule.action} | Mode: ${policy.settings?.blockMode ?? 'strict'}

const CONDITIONS = [${conditions}];

function check(input) {
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const command = toolInput.command || '';

  for (const cond of CONDITIONS) {
    switch (cond.type) {
      case 'dirty_tree': {
        try {
          const cp = require('child_process');
          const gitStatus = cp.spawnSync('git', ['status', '--porcelain'], {
            cwd: input.cwd || process.cwd(),
            encoding: 'utf-8',
          });
          const lines = String(gitStatus.stdout || '').split(/\\r?\\n/).filter(l => l.trim().length > 0);
          let allowRe = null;
          if (cond.pattern) {
            try { allowRe = new RegExp(cond.pattern); } catch (e) { allowRe = null; }
          }
          const dirty = lines.filter(line => {
            const entryPath = line.slice(3);
            return !(allowRe && allowRe.test(entryPath));
          });
          if (dirty.length > 0) {
            return { blocked: true, reason: cond.message + ': ' + dirty.length + ' changed entr' + (dirty.length === 1 ? 'y' : 'ies') + ' (e.g. ' + dirty[0].slice(3) + '). Commit your changes or run: scale commit-suggest' };
          }
        } catch (e) {
          process.stderr.write('[SCALE SHIELD WARN] dirty-tree check skipped: ' + (e && e.message ? e.message : String(e)) + '\\n');
        }
        break;
      }
      case 'protected_path': {
        const filePath = toolInput.file_path || toolInput.path || '';
        if (filePath.includes('.scale/') || filePath.includes('.hook-state/')) {
          return { blocked: true, reason: cond.message || 'Protected path: ' + filePath };
        }
        break;
      }
      case 'dangerous_command': {
        const patterns = [
          /\\brm\\s+-rf\\b/, /\\bDROP\\s+TABLE\\b/i, /\\bDROP\\s+DATABASE\\b/i,
          /\\bTRUNCATE\\s+TABLE\\b/i, /git\\s+push\\s+--force/, /git\\s+push\\s+-f\\b/,
          /git\\s+reset\\s+--hard/, /curl.*\\|\\s*bash\\b/, /wget.*\\|\\s*bash\\b/,
          /\\bchmod\\s+777\\b/, /\\bDELETE\\s+FROM\\b(?!.*\\bWHERE\\b)/i,
          /\\bdocker\\s+rm\\s+-f\\b/, /\\bkubectl\\s+delete\\b/,
        ];
        for (const p of patterns) {
          if (p.test(command)) {
            return { blocked: true, reason: cond.message || 'Dangerous command: ' + command };
          }
        }
        break;
      }
      case 'gate_required': {
        if (/git\\s+commit/.test(command)) {
          try {
            const fs = require('fs');
            const path = require('path');
            const stateFile = path.join(input.cwd || process.cwd(), '.hook-state', 'Stop.json');
            if (fs.existsSync(stateFile)) {
              const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
              if (!state.reason || !state.reason.includes('gate-quality:PASS')) {
                return { blocked: true, reason: 'Gate quality not passed. Run: scale gate-quality' };
              }
            } else {
              return { blocked: true, reason: 'No gate state found. Run: scale gate-quality before commit' };
            }
          } catch (e) {
            process.stderr.write('[SCALE SHIELD WARN] Gate state check skipped: ' + (e && e.message ? e.message : String(e)) + '\\n');
          }
        }
        break;
      }
      case 'secret_pattern': {
        const secretPatterns = [
          /\\bcat\\s+.*\\.env\\b/, /\\becho\\s+.*\\$?API[_-]?KEY\\b/i,
          /\\becho\\s+.*\\$?TOKEN\\b/i, /\\becho\\s+.*\\$?SECRET\\b/i,
          /\\becho\\s+.*\\$?PASSWORD\\b/i,
        ];
        for (const p of secretPatterns) {
          if (p.test(command)) {
            return { blocked: true, reason: cond.message || 'Potential secret exposure' };
          }
        }
        break;
      }
      case 'custom': {
        if (cond.pattern) {
          try {
            const re = new RegExp(cond.pattern, 'i');
            if (re.test(command)) {
              return { blocked: true, reason: cond.message || 'Custom rule matched' };
            }
          } catch (e) {
            process.stderr.write('[SCALE SHIELD WARN] Invalid custom rule pattern ignored: ' + (e && e.message ? e.message : String(e)) + '\\n');
          }
        }
        break;
      }
    }
  }
  return { blocked: false, reason: 'OK' };
}

try {
  const raw = process.argv[2] || '{}';
  const input = JSON.parse(raw);
  const result = check(input);
  if (result.blocked) {
    process.stderr.write('${blockedPrefix}' + result.reason + '\\n');
    ${blockFn};
  }
  process.exit(0);
} catch (e) {
  process.stderr.write('[SCALE SHIELD ERROR] ' + e.message + '\\n');
  process.exit(0); // fail open on parse error
}
`
  }

  private generateCombinedPreToolScript(policy: ShieldPolicy): string {
    const policyHash = createHash('sha256').update(JSON.stringify(policy)).digest('hex').slice(0, 12)
    // Generate an efficient combined check that runs all pre-tool rules in one pass
    const preToolRules = policy.rules.filter(r => r.hookType === 'PreToolUse')
    const isStrict = policy.settings?.blockMode !== 'warn'

    return `// SCALE Shield Combined PreToolUse Hook
// Policy hash: ${policyHash} | Rules: ${preToolRules.length} | Mode: ${policy.settings?.blockMode ?? 'strict'}
// Auto-generated — DO NOT EDIT

const BLOCKED_COMMANDS = ${JSON.stringify([
      'rm -rf', 'DROP TABLE', 'DROP DATABASE', 'TRUNCATE TABLE',
      'git push --force', 'git push -f', 'git reset --hard',
      'curl | bash', 'wget | bash', 'chmod 777', 'chmod -R 777',
      'docker rm -f', 'docker system prune', 'kubectl delete',
      'cat .env', 'eval ', '--no-verify', 'allowDangerously',
    ])};

const BLOCKED_COMMAND_PATTERNS = [
  { re: /\\brm\\s+-rf\\b/, reason: 'rm -rf is blocked' },
  { re: /\\bDROP\\s+TABLE\\b/i, reason: 'DROP TABLE is blocked' },
  { re: /\\bDROP\\s+DATABASE\\b/i, reason: 'DROP DATABASE is blocked' },
  { re: /\\bTRUNCATE\\s+TABLE\\b/i, reason: 'TRUNCATE TABLE is blocked' },
  { re: /git\\s+push\\s+--force/, reason: 'Force push is blocked' },
  { re: /git\\s+reset\\s+--hard/, reason: 'Hard reset is blocked' },
  { re: /git\\s+clean\\s+-[fd]+/, reason: 'Git clean with force flags is blocked' },
  { re: /curl.*\\|\\s*bash/, reason: 'curl-pipe-bash is blocked' },
  { re: /wget.*\\|\\s*bash/, reason: 'wget-pipe-bash is blocked' },
  { re: /\\bchmod\\s+777\\b/, reason: 'chmod 777 is blocked' },
  { re: /\\beval\\s+/i, reason: 'eval is blocked' },
  { re: /--no-verify/, reason: 'No-verify is blocked' },
  { re: /\\bDELETE\\s+FROM\\b(?!.*\\bWHERE\\b)/i, reason: 'DELETE without WHERE is blocked' },
  { re: /\\bdocker\\s+rm\\s+-f\\b/, reason: 'Docker force remove is blocked' },
  { re: /\\bkubectl\\s+delete\\b/, reason: 'kubectl delete is blocked' },
  { re: /\\bcat\\s+.*\\.env\\b/, reason: 'Reading .env files is blocked' },
  { re: /\\becho\\s+.*\\$?(API[_-]?KEY|TOKEN|SECRET|PASSWORD)\\b/i, reason: 'Echoing secrets is blocked' },
  { re: /SKIP_HOOKS|DISABLE_OMC|dang[eo]rously|bypass/i, reason: 'Governance bypass is blocked' },
];

function isProtectedPath(filePath) {
  const protected = ['.scale/', '.hook-state/', '.env', 'credentials', '.pem', '-key.json'];
  for (const p of protected) {
    if (filePath.includes(p)) return true;
  }
  return false;
}

try {
  const raw = process.argv[2] || '{}';
  const input = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const command = String(toolInput.command || '');

  // Check protected paths for Write/Edit
  if (toolName === 'Write' || toolName === 'Edit') {
    const fp = String(toolInput.file_path || toolInput.path || '');
    if (fp && isProtectedPath(fp)) {
      process.stderr.write('[SCALE SHIELD BLOCKED] Protected path: ' + fp + '\\n');
      process.exit(2);
    }
  }

  // Check dangerous commands for Bash
  if (toolName === 'Bash' && command) {
    for (const { re, reason } of BLOCKED_COMMAND_PATTERNS) {
      if (re.test(command)) {
        process.stderr.write('[SCALE SHIELD BLOCKED] ' + reason + '\\n');
        process.exit(2);
      }
    }
    // Gate check for git commit
    if (/git\\s+commit/.test(command)) {
      try {
        const fs = require('fs');
        const path = require('path');
        const cwd = input.cwd || process.cwd();
        const stopState = path.join(cwd, '.hook-state', 'Stop.json');
        if (fs.existsSync(stopState)) {
          const state = JSON.parse(fs.readFileSync(stopState, 'utf-8'));
          if (!state.reason || !state.reason.includes('gate-quality:PASS')) {
            process.stderr.write('[SCALE SHIELD BLOCKED] Gate quality check required before commit. Run: scale gate-quality\\n');
            process.exit(2);
          }
        }
      } catch (e) {
        process.stderr.write('[SCALE SHIELD WARN] Gate state check skipped: ' + (e && e.message ? e.message : String(e)) + '\\n');
      }
    }
  }

  // Write state for PostToolUse and Stop hooks
  try {
    const fs = require('fs');
    const path = require('path');
    const cwd = input.cwd || process.cwd();
    const stateDir = path.join(cwd, '.hook-state');
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'PreToolUse.json'), JSON.stringify({
      hook: 'PreToolUse',
      timestamp: new Date().toISOString(),
      sessionId: input.session_id || 'unknown',
      toolName,
      blocked: false,
    }));
  } catch (e) {
    process.stderr.write('[SCALE SHIELD WARN] Hook state write skipped: ' + (e && e.message ? e.message : String(e)) + '\\n');
  }

  process.exit(0);
} catch (e) {
  // Fail open on parse errors
  process.stderr.write('[SCALE SHIELD WARN] Parse error: ' + e.message + '\\n');
  process.exit(0);
}
`
  }

  private patchClaudeSettings(output: CompilerOutput): void {
    const settingsPath = output.settingsPatches.claude
    if (!existsSync(settingsPath)) return

    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      if (!settings.hooks) settings.hooks = {}

      // Register PreToolUse hook if not already present; keep repeated compiles idempotent.
      if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = []
      const deduped = dedupeShieldPreToolHooks(settings.hooks.PreToolUse)
      settings.hooks.PreToolUse = deduped.hooks

      if (!deduped.found) {
        settings.hooks.PreToolUse.push({
          type: 'command',
          command: `node .claude/hooks/shield-pre-tool.js`,
          timeout: 5000,
        })
        deduped.changed = true
      }
      if (this.registerStopHook(settings)) deduped.changed = true
      if (deduped.changed) {
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
        logger.info('Shield hook registered in Claude Code settings')
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to patch Claude settings.json')
    }
  }

  private patchHarnessSettings(settingsPath: string, output: CompilerOutput, _harness: string): void {
    if (!existsSync(settingsPath)) {
      // Create hooks.json if directory exists
      const dir = settingsPath.replace(/[/\\][^/\\]+$/, '')
      if (existsSync(dir)) {
        const config = {
          hooks: {
            PreToolUse: [
              { type: 'command', command: `node .claude/hooks/shield-pre-tool.js`, timeout: 5000 },
            ],
          },
        }
        this.registerStopHook(config)
        writeFileSync(settingsPath, JSON.stringify(config, null, 2))
        logger.info({ harness: _harness }, 'Shield hooks config created')
      }
      return
    }

    try {
      const config = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      if (!config.hooks) config.hooks = {}
      if (!Array.isArray(config.hooks.PreToolUse)) config.hooks.PreToolUse = []
      const deduped = dedupeShieldPreToolHooks(config.hooks.PreToolUse)
      config.hooks.PreToolUse = deduped.hooks
      if (!deduped.found) {
        config.hooks.PreToolUse.push({
          type: 'command',
          command: `node .claude/hooks/shield-pre-tool.js`,
          timeout: 5000,
        })
        deduped.changed = true
      }
      if (this.registerStopHook(config)) deduped.changed = true
      if (deduped.changed) {
        writeFileSync(settingsPath, JSON.stringify(config, null, 2))
        logger.info({ harness: _harness }, 'Shield hooks config patched')
      }
    } catch (err) {
      logger.warn({ err, harness: _harness }, 'Failed to patch harness settings')
    }
  }

  /**
   * Register the compiled Stop-hook rules (e.g. require-clean-worktree) so the
   * dirty-tree warning fires when a session ends. Idempotent.
   */
  private registerStopHook(settings: { hooks?: Record<string, unknown> }): boolean {
    const stopRules = DEFAULT_POLICY.rules.filter(rule => rule.hookType === 'Stop')
    if (stopRules.length === 0) return false
    if (!settings.hooks) settings.hooks = {}
    if (!Array.isArray(settings.hooks.Stop)) settings.hooks.Stop = []
    let changed = false
    for (const rule of stopRules) {
      const fileName = `shield-${rule.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.js`
      const command = `node .claude/hooks/${fileName}`
      const existing = (settings.hooks.Stop as Array<{ command?: string }>).some(entry => entry?.command === command)
      if (!existing) {
        ;(settings.hooks.Stop as unknown[]).push({ type: 'command', command, timeout: 10000 })
        changed = true
      }
    }
    return changed
  }
}

function dedupeShieldPreToolHooks(hooks: unknown[]): { hooks: unknown[]; found: boolean; changed: boolean } {
  const deduped: unknown[] = []
  let found = false
  let changed = false

  for (const hook of hooks) {
    if (!hookReferencesShieldPreTool(hook)) {
      deduped.push(hook)
      continue
    }

    if (found) {
      changed = true
      continue
    }

    found = true
    deduped.push(hook)
  }

  return { hooks: deduped, found, changed }
}

function hookReferencesShieldPreTool(hook: unknown): boolean {
  if (!hook || typeof hook !== 'object') return false
  const record = hook as Record<string, unknown>
  return ['command', 'scriptPath'].some(field => {
    const value = record[field]
    return typeof value === 'string' && value.includes('shield-pre-tool')
  })
}
