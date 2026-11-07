import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JudgeVerdict } from '../review/LlmJudge.js'
import type { FreshVerifyVerdict } from '../review/FreshContextVerifier.js'

/** P2.2 three-level review mode. Default `ai-self` = legacy behaviour. */
export type ReviewMode = 'ai-self' | 'fresh-subagent' | 'hybrid'

export type ReviewSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type ReviewCategory = 'style' | 'logic' | 'security' | 'performance' | 'process'

export interface ReviewFinding {
  category: ReviewCategory
  severity: ReviewSeverity
  description: string
  file?: string
  evidence?: string
}

export interface ReviewSummary {
  critical: number
  high: number
  medium: number
  low: number
}

/**
 * P1-A clean-context 隔离证明：记录独立审查「喂了什么、刻意排除了什么」，
 * 让隔离属性可审计（对照 Cognition 2026-04 的 clean-context reviewer）。
 */
export interface ContextIsolationProof {
  /** 实际喂给 verifier 的字段（仅声明面/ diff / gate 摘要）。 */
  fedFields: string[]
  /** 刻意排除的字段（构建 agent 的对话历史与自我评估）。 */
  excludedFields: string[]
  /** diff 摘要的 sha256 前缀，证明审查对象可复现。 */
  diffHash: string
  /** verificationSurface 条目数。 */
  surfaceCount: number
  gateSummaryIncluded: boolean
}

export interface ReviewRecord {
  id: string
  taskId?: string
  passed: boolean
  findings: ReviewFinding[]
  changedFiles: string[]
  summary: ReviewSummary
  /** Spec维度：diff 是否匹配原始 Spec/PRD 要求 */
  specFindings?: string[]
  /** Spec关键词覆盖率 0..1 */
  specCoverage?: number
  /** P1.4: advisory LLM-as-Judge verdict. Never affects `passed`. */
  judge?: JudgeVerdict
  /** P2.2: which review mode produced this record. Defaults to `ai-self`. */
  reviewMode?: ReviewMode
  /** P2.2: advisory fresh-context verifier verdict. Never affects `passed`. */
  freshVerify?: FreshVerifyVerdict
  /** P1-A: 独立审查的隔离输入证明（仅 fresh-subagent / hybrid 模式记录）。 */
  contextIsolation?: ContextIsolationProof
  /** P1-A: fresh-gate 是否已把 verdict 升级为阻断（off=advisory 时为 false）。 */
  freshGateEnforced?: boolean
  createdAt: number
}

export class ReviewStore {
  private reviewsDir: string

  constructor(scaleDir = process.env.SCALE_DIR ?? '.scale') {
    this.reviewsDir = join(scaleDir, 'reviews')
    if (!existsSync(this.reviewsDir)) mkdirSync(this.reviewsDir, { recursive: true })
  }

  saveReview(input: Omit<ReviewRecord, 'id' | 'createdAt'>): ReviewRecord {
    const record: ReviewRecord = {
      id: `REVIEW-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      ...input,
    }
    const file = join(this.reviewsDir, `${record.id}.json`)
    writeFileSync(file, JSON.stringify(record, null, 2), 'utf-8')
    return record
  }

  listReviews(limit = 20): ReviewRecord[] {
    if (!existsSync(this.reviewsDir)) return []
    return readdirSync(this.reviewsDir)
      .filter(file => file.endsWith('.json'))
      .map(file => this.readRecordFile(join(this.reviewsDir, file)))
      .filter((record): record is ReviewRecord => Boolean(record))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
  }

  getReview(id: string): ReviewRecord | null {
    const file = join(this.reviewsDir, `${id}.json`)
    return this.readRecordFile(file)
  }

  private readRecordFile(file: string): ReviewRecord | null {
    try {
      return JSON.parse(readFileSync(file, 'utf-8')) as ReviewRecord
    } catch {
      return null
    }
  }
}
