// Approval notifications (M4): best-effort only. A failed webhook or a
// missing lark-cli must never change an approval's state — the decision loop
// is the store + endpoints, this is just a loudspeaker. Secrets stay in env.

import { spawnSync } from 'node:child_process'
import { logger } from '../../core/logger.js'
import { buildFeishuSendMessageCommand } from '../../communication/FeishuChannelProvider.js'

export interface ApprovalNotifyInput {
  approvalId: string
  taskId: string
  projectId: string
  jobType: string
  estimatedCny: number | null
  expiresAt: string
}

export interface ApprovalNotifyResult {
  channel: 'feishu' | 'webhook' | 'none'
  ok: boolean
  /** why nothing was sent or delivery failed (no secrets, no URLs with tokens) */
  reason?: string
}

/** One-line human summary; cost is rendered without inventing a number. */
export function approvalNotificationText(input: ApprovalNotifyInput): string {
  const cost = input.estimatedCny === null ? '未知（fail-closed，需人工确认价格）' : `约 ${input.estimatedCny} CNY`
  return [
    `SCALE 审批请求 ${input.approvalId}`,
    `任务 ${input.taskId}（${input.jobType}，项目 ${input.projectId}）`,
    `估算成本：${cost}`,
    `过期时间：${input.expiresAt}（过期视为拒绝）`,
  ].join('\n')
}

function postWebhook(url: string, text: string): ApprovalNotifyResult {
  try {
    // sync, bounded: a hanging webhook must not stall job creation
    const response = spawnSync('node', ['-e', `
      const payload = JSON.stringify({ text: process.argv[1], approval: true });
      fetch(process.env.MEDIA_APPROVAL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(5000),
      }).then(r => { console.log(r.status); process.exit(r.ok ? 0 : 1) }).catch(() => process.exit(1));
    `, text], {
      encoding: 'utf-8',
      shell: false,
      windowsHide: true,
      timeout: 8000,
      env: { ...process.env, MEDIA_APPROVAL_WEBHOOK_URL: url },
    })
    if (response.status !== 0) {
      return { channel: 'webhook', ok: false, reason: `webhook POST failed (exit ${response.status})` }
    }
    return { channel: 'webhook', ok: true }
  } catch (error) {
    return { channel: 'webhook', ok: false, reason: `webhook POST threw: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function sendFeishu(chatId: string, text: string): ApprovalNotifyResult {
  let plan
  try {
    plan = buildFeishuSendMessageCommand({ chatId, text, as: 'bot', dryRun: false })
  } catch (error) {
    return { channel: 'feishu', ok: false, reason: `command build failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  const result = spawnSync(plan.command, plan.args, {
    encoding: 'utf-8',
    shell: false,
    windowsHide: true,
    timeout: 20000,
  })
  if (result.status !== 0) {
    // stderr may contain env details; keep only the first line
    const firstLine = (result.stderr ?? '').split('\n').find(Boolean) ?? 'no stderr'
    return { channel: 'feishu', ok: false, reason: `lark-cli exited ${result.status}: ${firstLine.slice(0, 200)}` }
  }
  return { channel: 'feishu', ok: true }
}

/**
 * Fire the configured channel(s). Feishu wins when MEDIA_APPROVAL_FEISHU_CHAT_ID
 * is set (lark-cli is still required and its absence is the failure reason);
 * otherwise the generic webhook is used. Never throws.
 */
export function notifyApprovalRequested(input: ApprovalNotifyInput): ApprovalNotifyResult {
  const chatId = process.env.MEDIA_APPROVAL_FEISHU_CHAT_ID?.trim()
  if (chatId) {
    const result = sendFeishu(chatId, approvalNotificationText(input))
    if (!result.ok) logger.warn({ approvalId: input.approvalId, reason: result.reason }, 'media approval feishu notification failed')
    return result
  }
  const webhookUrl = process.env.MEDIA_APPROVAL_WEBHOOK_URL?.trim()
  if (webhookUrl) {
    const result = postWebhook(webhookUrl, approvalNotificationText(input))
    if (!result.ok) logger.warn({ approvalId: input.approvalId, reason: result.reason }, 'media approval webhook notification failed')
    return result
  }
  return { channel: 'none', ok: true, reason: 'no notification channel configured (set MEDIA_APPROVAL_WEBHOOK_URL or MEDIA_APPROVAL_FEISHU_CHAT_ID)' }
}
