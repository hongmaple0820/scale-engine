function stripAnsi(value) {
  return String(value ?? '').replace(/\u001B\[[0-9;]*m/g, '')
}

export function summarizeCommandOutput(name, stream, value, max = 1600) {
  const sanitized = sanitizeCommandOutput(name, stream, stripAnsi(value))
  if (!sanitized.trim()) return ''
  const summary = commandSpecificSummary(name, stream, sanitized)
  return compactText(summary ?? sanitized, max)
}

export function summarizeCommandRecord(record) {
  if (!record) return record
  const {
    stdout,
    stderr,
    ...rest
  } = record
  return {
    ...rest,
    stdoutTail: summarizeCommandOutput(record.name, 'stdout', stdout ?? record.stdoutTail ?? ''),
    stderrTail: summarizeCommandOutput(record.name, 'stderr', stderr ?? record.stderrTail ?? ''),
  }
}

function sanitizeCommandOutput(name, stream, value) {
  let text = String(value ?? '').replace(/\r\n/g, '\n').replace(/[�]+/g, '')
  if (isGbrainCommand(name)) {
    if (stream === 'stderr') {
      text = text
        .replace(/^\s*The system cannot find the path specified\.\s*$/gim, '')
        .replace(/\n?={20,}\n[\s\S]*?The user owns this decision\.\n={20,}\n?/g, '\n')
    }
    if (stream === 'stdout' && /init/i.test(name)) {
      text = text
        .replace(/\n?═{10,}\n\[gbrain\] search mode tentatively set[\s\S]*?To see what is running: gbrain search modes\n*/g, '\n')
        .replace(/\n--- GBrain Mod Status ---[\s\S]*$/g, '')
    }
  }
  return normalizeMultiline(text)
}

function commandSpecificSummary(name, stream, value) {
  if (stream !== 'stdout') return undefined
  if (name === 'gbrain-init' || name === 'gbrain-init-isolated-home') {
    return collectMatchingLines(value, [
      /migration\(s\) applied/i,
      /^Brain ready at /i,
      /^0 pages\./i,
      /^Next: /i,
      /^When you outgrow local:/i,
    ])
  }
  if (name === 'graphify-rebuild' || name === 'graphify-update' || name === 'graphify-extract') {
    return collectMatchingLines(value, [
      /Rebuilt/i,
      /graph\.json updated/i,
      /^Code graph updated\./i,
      /^Tip:/i,
    ])
  }
  if (name === 'graphify-benchmark') {
    return collectMatchingLines(value, [
      /^graphify token reduction benchmark$/i,
      /^\s*Corpus:/i,
      /^\s*Graph:/i,
      /^\s*Avg query cost:/i,
      /^\s*Reduction:/i,
    ])
  }
  if (name === 'graphify-query') {
    return firstInterestingLines(value, 12)
  }
  return undefined
}

function collectMatchingLines(value, patterns) {
  const lines = normalizeMultiline(value).split('\n').map(line => line.trim()).filter(Boolean)
  const selected = lines.filter(line => patterns.some(pattern => pattern.test(line)))
  return selected.length > 0 ? selected.join('\n') : undefined
}

function firstInterestingLines(value, maxLines) {
  const lines = normalizeMultiline(value)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^[=._-]{6,}$/.test(line))
  return lines.slice(0, maxLines).join('\n')
}

function compactText(value, max) {
  const normalized = normalizeMultiline(value)
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1)}…`
}

function normalizeMultiline(value) {
  return String(value ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isGbrainCommand(name) {
  return /^gbrain-/i.test(String(name ?? ''))
}
