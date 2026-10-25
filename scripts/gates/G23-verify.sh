#!/usr/bin/env bash
# G23: Temp-output discipline — no mkdtemp/mkdir temp dirs anchored at the
# project cwd (must use .scale/tmp/ or the OS tempdir). plan 2026-10-24 §2.3.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[G23] Temp-output discipline"
cd "$REPO_ROOT"

ERRORS=0

# Pattern set: any temp-dir creation anchored at cwd (process.cwd() or bare '.'),
# in src/ or tests/. OS tmpdir() and .scale/tmp are the sanctioned forms.
PAT_1='mkdtempSync(join(process.cwd()'
PAT_2="mkdtempSync(join(cwd, '.tmp"
PAT_3='mkdirSync(join(process.cwd(), \x27.tmp'
PAT_4="join(process.cwd(), '.tmp-tests')"

check_pattern() {
  local label="$1" pattern="$2"
  local hits
  hits="$(grep -rIn --include='*.ts' --include='*.mjs' "$pattern" src/ tests/ scripts/ 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    echo "  [BLOCK] $label — temp dir anchored at project cwd:"
    echo "$hits" | head -5 | sed 's/^/    /'
    ERRORS=$((ERRORS + 1))
  else
    echo "  [OK] $label"
  fi
}

check_pattern "mkdtemp at process.cwd()" "$PAT_1"
check_pattern "mkdtemp at cwd .tmp" "$PAT_2"
check_pattern "mkdir at cwd .tmp" "$PAT_3"
check_pattern "cwd .tmp-tests paths" "$PAT_4"

# Stray .tmp-* directories at repo root (older than this run) are also violations.
STRAYS="$(find . -maxdepth 1 -name '.tmp-*' -o -maxdepth 1 -name '.tmp_tests' 2>/dev/null | head -5 || true)"
if [ -n "$STRAYS" ]; then
  echo "  [BLOCK] stray temp dirs at repo root (run: scale clean / rm -rf .tmp-*):"
  echo "$STRAYS" | sed 's/^/    /'
  ERRORS=$((ERRORS + 1))
else
  echo "  [OK] no stray .tmp-* at repo root"
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "[G23] FAIL — $ERRORS violation(s). Temp outputs belong in .scale/tmp/ or the OS tempdir."
  exit 1
fi
echo "[G23] PASS"
