// SCALE Shield Combined PreToolUse Hook
// Policy hash: d3410c07039f | Rules: 8 | Mode: strict  # strict = 阻断, warn = 仅警告
// Auto-generated — DO NOT EDIT

const BLOCKED_COMMANDS = ["rm -rf","DROP TABLE","DROP DATABASE","TRUNCATE TABLE","git push --force","git push -f","git reset --hard","curl | bash","wget | bash","chmod 777","chmod -R 777","docker rm -f","docker system prune","kubectl delete","cat .env","eval ","--no-verify","allowDangerously"];

const BLOCKED_COMMAND_PATTERNS = [
  { re: /\brm\s+-rf\b/, reason: 'rm -rf is blocked' },
  { re: /\bDROP\s+TABLE\b/i, reason: 'DROP TABLE is blocked' },
  { re: /\bDROP\s+DATABASE\b/i, reason: 'DROP DATABASE is blocked' },
  { re: /\bTRUNCATE\s+TABLE\b/i, reason: 'TRUNCATE TABLE is blocked' },
  { re: /git\s+push\s+--force/, reason: 'Force push is blocked' },
  { re: /git\s+reset\s+--hard/, reason: 'Hard reset is blocked' },
  { re: /git\s+clean\s+-[fd]+/, reason: 'Git clean with force flags is blocked' },
  { re: /curl.*\|\s*bash/, reason: 'curl-pipe-bash is blocked' },
  { re: /wget.*\|\s*bash/, reason: 'wget-pipe-bash is blocked' },
  { re: /\bchmod\s+777\b/, reason: 'chmod 777 is blocked' },
  { re: /\beval\s+/i, reason: 'eval is blocked' },
  { re: /--no-verify/, reason: 'No-verify is blocked' },
  { re: /\bDELETE\s+FROM\b(?!.*\bWHERE\b)/i, reason: 'DELETE without WHERE is blocked' },
  { re: /\bdocker\s+rm\s+-f\b/, reason: 'Docker force remove is blocked' },
  { re: /\bkubectl\s+delete\b/, reason: 'kubectl delete is blocked' },
  { re: /\bcat\s+.*\.env\b/, reason: 'Reading .env files is blocked' },
  { re: /\becho\s+.*\$?(API[_-]?KEY|TOKEN|SECRET|PASSWORD)\b/i, reason: 'Echoing secrets is blocked' },
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
      process.stderr.write('[SCALE SHIELD BLOCKED] Protected path: ' + fp + '\n');
      process.exit(2);
    }
  }

  // Check dangerous commands for Bash
  if (toolName === 'Bash' && command) {
    for (const { re, reason } of BLOCKED_COMMAND_PATTERNS) {
      if (re.test(command)) {
        process.stderr.write('[SCALE SHIELD BLOCKED] ' + reason + '\n');
        process.exit(2);
      }
    }
    // Gate check for git commit
    if (/git\s+commit/.test(command)) {
      try {
        const fs = require('fs');
        const path = require('path');
        const cwd = input.cwd || process.cwd();
        const stopState = path.join(cwd, '.hook-state', 'Stop.json');
        if (fs.existsSync(stopState)) {
          const state = JSON.parse(fs.readFileSync(stopState, 'utf-8'));
          if (!state.reason || !state.reason.includes('gate-quality:PASS')) {
            process.stderr.write('[SCALE SHIELD BLOCKED] Gate quality check required before commit. Run: scale gate-quality\n');
            process.exit(2);
          }
        }
      } catch (e) { /* allow on error */ }
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
  } catch (e) { /* state write is best-effort */ }

  process.exit(0);
} catch (e) {
  // Fail open on parse errors
  process.stderr.write('[SCALE SHIELD WARN] Parse error: ' + e.message + '\n');
  process.exit(0);
}
