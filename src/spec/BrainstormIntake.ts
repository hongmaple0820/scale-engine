// SCALE Engine — P2-D 头脑风暴前置互操作（翻译层）
//
// superpowers brainstorming / BMAD forge-idea 等前置收敛工具常输出
// Given/When/Then（GWT）或项目符号验收清单。本模块把这些「头脑风暴产物」
// 翻译为 SCALE 的 EARS+ 验收标准，再交给 AcceptanceCompiler 编译为可执行检查。
//
// 只做翻译，不重写头脑风暴——那是别人的强项；SCALE 负责「把一句话验收标准
// 变成机器可校验的 check」这一层（衔接 CMU/Google SDD 研究的工具缺口）。
//
// 纯函数：无 fs、无 LLM。

import type { AcceptanceCriterionInput } from './AcceptanceCompiler.js'

export interface BrainstormIntakeResult {
  criteria: AcceptanceCriterionInput[]
  /** 识别为标题/分隔/无法转成验收标准的行（保留供人工复核）。 */
  dropped: string[]
  converted: number
}

export interface BrainstormIntakeOptions {
  /** 生成 id 的前缀，默认 BS。 */
  idPrefix?: string
}

const GWT_LINE = /^\s*(?:[-*]\s*)?Given\s+(.+?)\s*,?\s*When\s+(.+?)\s*,?\s*Then\s+(.+?)\s*$/i
const WHEN_THEN_LINE = /^\s*(?:[-*]\s*)?When\s+(.+?)\s*,?\s*Then\s+(.+?)\s*$/i
const EARS_ALREADY = /\b(WHEN|WHILE|IF|WHERE)\b.*\bSHALL\b/i
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+)$/
const HEADING = /^\s*#{1,6}\s/

function stripTrailingPunctuation(text: string): string {
  return text.trim().replace(/[.。;；,，]+$/, '')
}

function toShall(text: string): string {
  const cleaned = stripTrailingPunctuation(text)
  if (/\bSHALL\b/.test(cleaned)) return cleaned
  if (/^(the |system |it |app |user )/i.test(cleaned)) return `${cleaned} SHALL be satisfied`
  return `The system SHALL ${cleaned}`
}

function nextId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, '0')}`
}

/**
 * 把头脑风暴文本（GWT / 项目符号验收清单 / 已是 EARS 的行）翻译成 EARS+ criteria。
 */
export function intakeBrainstorm(text: string, options: BrainstormIntakeOptions = {}): BrainstormIntakeResult {
  const prefix = options.idPrefix ?? 'BS'
  const criteria: AcceptanceCriterionInput[] = []
  const dropped: string[] = []
  let counter = 0

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (HEADING.test(raw)) { dropped.push(line); continue }

    // 1) Given/When/Then（单行）
    const gwt = line.match(GWT_LINE)
    if (gwt) {
      const [, given, when, then] = gwt
      counter += 1
      criteria.push({
        id: nextId(prefix, counter),
        text: `WHEN ${stripTrailingPunctuation(when)} (given ${stripTrailingPunctuation(given)}) THEN the system SHALL ${stripTrailingPunctuation(then)}`,
        kind: 'event',
      })
      continue
    }

    // 2) When/Then（单行）
    const wt = line.match(WHEN_THEN_LINE)
    if (wt) {
      const [, when, then] = wt
      counter += 1
      criteria.push({
        id: nextId(prefix, counter),
        text: `WHEN ${stripTrailingPunctuation(when)} THEN the system SHALL ${stripTrailingPunctuation(then)}`,
        kind: 'event',
      })
      continue
    }

    // 3) 已是 EARS+ 的行
    if (EARS_ALREADY.test(line)) {
      counter += 1
      criteria.push({ id: nextId(prefix, counter), text: line.replace(/^[-*+]\s+/, ''), kind: 'event' })
      continue
    }

    // 4) 项目符号 / 有序列表验收项
    const listItem = line.match(LIST_ITEM)
    if (listItem) {
      counter += 1
      criteria.push({ id: nextId(prefix, counter), text: toShall(listItem[1]), kind: 'ubiquitous' })
      continue
    }

    // 5) 普通陈述句（含明确动词或主语）
    if (/[A-Za-z\u4e00-\u9fa5]/.test(line) && line.length >= 8) {
      counter += 1
      criteria.push({ id: nextId(prefix, counter), text: toShall(line), kind: 'ubiquitous' })
      continue
    }

    dropped.push(line)
  }

  return { criteria, dropped, converted: criteria.length }
}
