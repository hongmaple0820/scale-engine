// SCALE Engine — Onboard Wizard
// Interactive questionnaire that recommends a profile based on user answers.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process'
import { createInterface, type Interface } from 'node:readline'
import { classifyProject, detectPlatform, type ProjectClassification } from './quickstart.js'
import { listProfiles, type ConfigProfile } from '../config/profiles.js'

export interface OnboardQuestion {
  id: string
  question: string
  options: Array<{ label: string; value: string }>
}

export interface OnboardAnswer {
  questionId: string
  value: string
}

export interface OnboardRecommendation {
  profileId: string
  profileName: string
  reason: string
  confidence: number
  governancePack: string
  classification: ProjectClassification
  platform: string | null
  answers: OnboardAnswer[]
  nextSteps: string[]
}

export const ONBOARD_QUESTIONS: OnboardQuestion[] = [
  {
    id: 'experience',
    question: '你对 AI 辅助开发的经验如何？',
    options: [
      { label: '新手 — 第一次使用 AI 编码工具', value: 'beginner' },
      { label: '有经验 — 用过 Copilot/Cursor 等工具', value: 'intermediate' },
      { label: '高级 — 深度使用 AI agent，了解 prompt engineering', value: 'advanced' },
    ],
  },
  {
    id: 'project-stage',
    question: '你的项目处于什么阶段？',
    options: [
      { label: '原型/MVP — 快速迭代，不太关注质量', value: 'prototype' },
      { label: '开发中 — 需要稳定的质量保障', value: 'development' },
      { label: '生产环境 — 需要严格的治理和审计', value: 'production' },
    ],
  },
  {
    id: 'team-size',
    question: '团队规模？',
    options: [
      { label: '个人项目 — 只有我一个人', value: 'solo' },
      { label: '小团队 — 2-5 人', value: 'small' },
      { label: '大团队 — 5 人以上', value: 'large' },
    ],
  },
  {
    id: 'priority',
    question: '你最看重什么？',
    options: [
      { label: '速度 — 快速上手，最少配置', value: 'speed' },
      { label: '平衡 — 适当的治理，不影响效率', value: 'balance' },
      { label: '质量 — 完整的门禁和审计', value: 'quality' },
    ],
  },
]

interface PromptSession {
  rl: Interface
  output: NodeJS.WritableStream
  iterator: AsyncIterator<string>
}

function createPromptSession(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): PromptSession {
  const rl = createInterface({ input, output })
  const iterator = (async function* () {
    for await (const line of rl) yield line
  })()
  return { rl, output, iterator }
}

async function ask(session: PromptSession, question: string): Promise<string> {
  session.output.write(`${question}\n`)
  const result = await session.iterator.next()
  return (result.value as string ?? '').trim()
}

export function getOnboardQuestions(): OnboardQuestion[] {
  return ONBOARD_QUESTIONS
}

export function recommendProfile(answers: OnboardAnswer[], classification: ProjectClassification): Omit<OnboardRecommendation, 'classification' | 'platform' | 'answers' | 'nextSteps'> {
  let score = { minimal: 0, standard: 0, advanced: 0, 'china-local': 0 }

  for (const answer of answers) {
    switch (answer.questionId) {
      case 'experience':
        if (answer.value === 'beginner') { score.minimal += 2; score.standard += 1 }
        else if (answer.value === 'intermediate') { score.standard += 2; score.minimal += 1 }
        else { score.advanced += 2; score.standard += 1 }
        break
      case 'project-stage':
        if (answer.value === 'prototype') { score.minimal += 2 }
        else if (answer.value === 'development') { score.standard += 2 }
        else { score.advanced += 2 }
        break
      case 'team-size':
        if (answer.value === 'solo') { score.minimal += 1; score.standard += 1 }
        else if (answer.value === 'small') { score.standard += 2 }
        else { score.advanced += 2 }
        break
      case 'priority':
        if (answer.value === 'speed') { score.minimal += 2 }
        else if (answer.value === 'balance') { score.standard += 2 }
        else { score.advanced += 2; score.standard += 1 }
        break
    }
  }

  // Factor in project classification
  if (classification.recommendedProfile === 'minimal') score.minimal += 1
  else if (classification.recommendedProfile === 'critical') score.advanced += 1
  else score.standard += 1

  // Find winner
  const entries = Object.entries(score) as Array<[keyof typeof score, number]>
  entries.sort((a, b) => b[1] - a[1])
  const [winnerId, winnerScore] = entries[0]
  const totalScore = entries.reduce((sum, [, v]) => sum + v, 0)
  const confidence = totalScore > 0 ? winnerScore / totalScore : 0.5

  const profiles = listProfiles()
  const winner = profiles.find(p => p.id === winnerId) ?? profiles.find(p => p.id === 'standard')!

  const reasons: Record<string, string> = {
    minimal: '你是新手或项目处于原型阶段，minimal profile 提供最简配置，让你快速上手。',
    standard: '你的项目处于开发阶段，standard profile 提供适当的治理保障，平衡效率和质量。',
    advanced: '你的项目需要严格治理，advanced profile 提供完整的门禁、知识图谱和进化能力。',
    'china-local': '你在中国大陆，china-local profile 优化了本地模型部署。',
  }

  return {
    profileId: winnerId,
    profileName: winner.name,
    reason: reasons[winnerId] ?? reasons.standard,
    confidence,
    governancePack: classification.recommendedPack,
  }
}

export async function runOnboardWizard(options: {
  projectDir?: string
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  answers?: OnboardAnswer[]
  lang?: 'zh' | 'en'
} = {}): Promise<OnboardRecommendation> {
  const projectDir = options.projectDir ?? process.cwd()
  const input = options.input ?? defaultInput
  const output = options.output ?? defaultOutput
  const classification = classifyProject(projectDir)
  const platformResult = detectPlatform(projectDir)

  let answers = options.answers

  if (!answers) {
    const session = createPromptSession(input, output)
    answers = []

    output.write('\n🎯 SCALE Engine — 个性化配置向导\n')
    output.write('回答 4 个问题，我来推荐最适合你的配置。\n\n')

    for (const q of ONBOARD_QUESTIONS) {
      output.write(`📋 ${q.question}\n`)
      for (let i = 0; i < q.options.length; i++) {
        output.write(`  ${i + 1}. ${q.options[i].label}\n`)
      }

      let choice = ''
      while (!choice) {
        const input_val = await ask(session, '请输入编号 (1/2/3): ')
        const idx = parseInt(input_val, 10) - 1
        if (idx >= 0 && idx < q.options.length) {
          choice = q.options[idx].value
        }
      }

      answers.push({ questionId: q.id, value: choice })
      output.write('\n')
    }

    session.rl.close()
  }

  const recommendation = recommendProfile(answers, classification)

  const nextSteps: string[] = [
    `scale init --profile ${recommendation.profileId}`,
    `scale setup --pack full --memory-provider hrain --memory-mode local-only --apply --yes`,
    `scale setup --verify --pack full --json`,
    `scale preflight --preflight-profile quick`,
  ]

  if (recommendation.profileId === 'advanced') {
    nextSteps.push(`scale cortex evolve --project .`)
  }

  return {
    ...recommendation,
    classification,
    platform: platformResult.platform,
    answers,
    nextSteps,
  }
}
