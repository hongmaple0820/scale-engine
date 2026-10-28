// SCALE Shield Combined PreToolUse Hook
// Policy hash: 39707e824869 | Rules: 8 | Mode: strict  # strict = 阻断, warn = 仅警告
// Auto-generated — DO NOT EDIT
// Command rules are generated from ProtectedPaths.serializeCommandRules() —
// the single source of truth (was a divergent hardcoded list; convergence
// pinned by tests/shield/shieldSourceConvergence.test.ts).

const COMMAND_RULE_DATA = [{"re":"\\brm\\s+-rf\\b","flags":"","reason":"Recursive force delete (rm -rf) — data loss risk","severity":"block","category":"destructive"},{"re":"\\brm\\s+-r\\b","flags":"","reason":"Recursive delete (rm -r)","severity":"block","category":"destructive"},{"re":"\\brmdir\\b","flags":"","reason":"Remove directory","severity":"warn","category":"destructive"},{"re":"\\bremove-item\\b(?=[^|]*\\s-recurse\\b)(?=[^|]*\\s-force\\b)","flags":"i","reason":"PowerShell recursive force delete (Remove-Item -Recurse -Force) — data loss risk","severity":"block","category":"destructive"},{"re":"\\bremove-item\\b[^|]*\\s-recurse\\b","flags":"i","reason":"PowerShell recursive delete (Remove-Item -Recurse)","severity":"warn","category":"destructive"},{"re":"\\b(rd|rmdir)\\s+\\/s\\b","flags":"i","reason":"cmd recursive delete (rd /s) — data loss risk","severity":"block","category":"destructive"},{"re":"\\bdel\\b(?=[^|]*\\/s\\b)(?=[^|]*\\/q\\b)","flags":"i","reason":"cmd recursive quiet delete (del /s /q) — data loss risk","severity":"block","category":"destructive"},{"re":"git\\s+clean\\s+-[fd]+","flags":"","reason":"Git clean with force — removes untracked files","severity":"block","category":"destructive"},{"re":"git\\s+reset\\s+--hard","flags":"","reason":"Git hard reset — destroys uncommitted work","severity":"block","category":"destructive"},{"re":"git\\s+push\\s+--force","flags":"","reason":"Git force push — overwrites remote history","severity":"block","category":"destructive"},{"re":"git\\s+push\\s+-f\\b","flags":"","reason":"Git force push (short flag)","severity":"block","category":"destructive"},{"re":"git\\s+checkout\\s+--\\s","flags":"","reason":"Git checkout — discards working changes","severity":"warn","category":"destructive"},{"re":"git\\s+stash\\s+drop","flags":"","reason":"Git stash drop — permanent stash deletion","severity":"warn","category":"destructive"},{"re":"git\\s+branch\\s+-D\\b","flags":"","reason":"Git branch force delete","severity":"block","category":"destructive"},{"re":"chmod\\s+777\\b","flags":"","reason":"World-writable permissions (chmod 777)","severity":"block","category":"security"},{"re":"chmod\\s+-R\\s+777","flags":"","reason":"Recursive world-writable (chmod -R 777)","severity":"block","category":"security"},{"re":"chown\\s+root","flags":"","reason":"Change ownership to root","severity":"warn","category":"security"},{"re":"\\bdocker\\s+rm\\s+-f\\b","flags":"","reason":"Docker force remove container","severity":"warn","category":"destructive"},{"re":"\\bdocker\\s+system\\s+prune\\b","flags":"","reason":"Docker system prune — removes all unused data","severity":"block","category":"destructive"},{"re":"\\bkubectl\\s+delete\\b","flags":"","reason":"Kubernetes resource deletion","severity":"block","category":"destructive"},{"re":"\\bDROP\\s+TABLE\\b","flags":"i","reason":"SQL DROP TABLE — data loss","severity":"block","category":"data-loss"},{"re":"\\bDROP\\s+DATABASE\\b","flags":"i","reason":"SQL DROP DATABASE — catastrophic data loss","severity":"block","category":"data-loss"},{"re":"\\bTRUNCATE\\s+TABLE\\b","flags":"i","reason":"SQL TRUNCATE TABLE — data loss","severity":"block","category":"data-loss"},{"re":"\\bDELETE\\s+FROM\\b(?!.*\\bWHERE\\b)","flags":"i","reason":"SQL DELETE without WHERE — full table deletion","severity":"block","category":"data-loss"},{"re":"\\bcat\\s+.*\\.env\\b","flags":"","reason":"Reading .env file — potential secret exposure in output","severity":"block","category":"security"},{"re":"\\becho\\s+.*\\$?API[_-]?KEY\\b","flags":"i","reason":"Printing API key — secret exposure","severity":"block","category":"security"},{"re":"\\becho\\s+.*\\$?TOKEN\\b","flags":"i","reason":"Printing token — secret exposure","severity":"block","category":"security"},{"re":"\\becho\\s+.*\\$?SECRET\\b","flags":"i","reason":"Printing secret — credential leak","severity":"block","category":"security"},{"re":"\\becho\\s+.*\\$?PASSWORD\\b","flags":"i","reason":"Printing password — credential leak","severity":"block","category":"security"},{"re":"\\bcurl.*\\|\\s*bash\\b","flags":"","reason":"curl-pipe-bash — remote code execution risk","severity":"block","category":"security"},{"re":"\\bwget.*\\|\\s*bash\\b","flags":"","reason":"wget-pipe-bash — remote code execution risk","severity":"block","category":"security"},{"re":"\\beval\\s+","flags":"i","reason":"eval — code injection risk","severity":"block","category":"security"},{"re":"--no-verify\\b","flags":"","reason":"Skipping git hooks (--no-verify)","severity":"block","category":"governance-bypass"},{"re":"--no-gpg-sign\\b","flags":"","reason":"Skipping GPG signing","severity":"warn","category":"governance-bypass"},{"re":"\\.claude\\b.*\\brm\\b","flags":"","reason":"Modifying .claude directory — potential hook bypass","severity":"block","category":"governance-bypass"},{"re":"\\.codex\\b.*\\brm\\b","flags":"","reason":"Modifying .codex directory — potential hook bypass","severity":"block","category":"governance-bypass"},{"re":"SKIP_HOOKS","flags":"i","reason":"Environment variable to skip hooks — governance bypass","severity":"block","category":"governance-bypass"},{"re":"DISABLE_OMC","flags":"i","reason":"OMC disable flag — governance bypass","severity":"block","category":"governance-bypass"},{"re":"dang[eo]rously","flags":"i","reason":"Dangerous mode flag — safety bypass","severity":"block","category":"governance-bypass"},{"re":"bypass","flags":"i","reason":"Bypass flag detected","severity":"warn","category":"governance-bypass"},{"re":"allowDangerously","flags":"i","reason":"allowDangerously flag — sandbox escape","severity":"block","category":"governance-bypass"}];
const BLOCKED_COMMAND_PATTERNS = COMMAND_RULE_DATA.map(r => ({ ...r, re: new RegExp(r.re, r.flags) }));

function isProtectedPath(filePath) {
  const protectedPaths = ['.scale/', '.hook-state/', '.env', 'credentials', '.pem', '-key.json'];
  for (const p of protectedPaths) {
    if (filePath.includes(p)) return true;
  }
  return false;
}

try {
  let raw = process.argv[2];
  if (!raw) {
    try { raw = require('fs').readFileSync(0, 'utf-8'); } catch (e) { raw = ''; }
  }
  if (!raw || !raw.trim()) raw = '{}';
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
    const warnNotes = [];
    for (const { re, reason, severity } of BLOCKED_COMMAND_PATTERNS) {
      if (re.test(command)) {
        if (severity === 'warn') { warnNotes.push(reason); continue; }
        process.stderr.write('[SCALE SHIELD BLOCKED] ' + reason + '\n');
        process.exit(2);
      }
    }
    for (const note of warnNotes) {
      process.stderr.write('[SCALE SHIELD WARN] ' + note + '\n');
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
      } catch (e) {
        process.stderr.write('[SCALE SHIELD WARN] Gate state check skipped: ' + (e && e.message ? e.message : String(e)) + '\n');
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
    process.stderr.write('[SCALE SHIELD WARN] Hook state write skipped: ' + (e && e.message ? e.message : String(e)) + '\n');
  }

  process.exit(0);
} catch (e) {
  // Fail open on parse errors
  process.stderr.write('[SCALE SHIELD WARN] Parse error: ' + e.message + '\n');
  process.exit(0);
}
