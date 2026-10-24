// SCALE Engine — Agent 派发链路验收脚本
// 用法: node scripts/qa/verify-agent-dispatch.mjs [--port 3210] [--session default]
// 无需任何 agent CLI 认证即可验证：会话配置 → 消息派发 → 真实子进程执行 → 回复回流 → 失败路径
// 以及治理配置读写、任务生命周期。

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const BASE = `http://127.0.0.1:${argValue('--port', process.env.SCALE_DASHBOARD_PORT ?? '3210')}`
const SESSION = argValue('--session', 'default')

const results = []
function record(name, passed, detail = '') {
  results.push({ name, passed, detail })
  console.log(`${passed ? '[PASS]' : '[FAIL]'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function call(method, path, body) {
  const response = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let payload
  try { payload = JSON.parse(text) } catch { payload = { raw: text.slice(0, 200) } }
  return { status: response.status, ok: response.ok, payload }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// 一个最小 agent 桩：模拟 CLI 的非交互模式，成功/失败两种行为
function writeStub() {
  const dir = mkdtempSync(join(tmpdir(), 'scale-agent-stub-'))
  const path = join(dir, 'agent-stub.mjs')
  writeFileSync(path, `const args = process.argv.slice(2)
const fail = args.includes('--fail')
const prompt = args.filter(a => a !== '--fail').join(' ')
if (fail) {
  console.error('agent-stub error: refused ' + prompt)
  process.exit(1)
}
console.log('agent-stub received prompt: ' + prompt)
console.log('agent-stub done')
`, 'utf-8')
  return { path, dir }
}

async function main() {
  console.log(`\nSCALE agent dispatch acceptance — ${BASE} (session: ${SESSION})\n`)
  const stub = writeStub()
  try {
    // ---------------------------------------------------------------
    // 0) 面板存活
    // ---------------------------------------------------------------
    const health = await call('GET', '/api/agent-control')
    record('面板服务可达', health.ok, `${BASE} -> ${health.status}`)
    if (!health.ok) {
      console.log('\n面板未运行。请先用 `node dist/api/http.js` 启动，或调整 --port。')
      process.exitCode = 1
      return
    }

    // ---------------------------------------------------------------
    // 1) 治理配置读 / 写 / 校验
    // ---------------------------------------------------------------
    const configBefore = await call('GET', '/api/v1/governance/config')
    record('治理配置可读取', configBefore.ok && Boolean(configBefore.payload.policy),
      configBefore.ok ? `policy 规则 ${configBefore.payload.policy.ruleCount} 条` : `HTTP ${configBefore.status}`)

    const badThreshold = await call('PUT', '/api/v1/governance/config/thresholds', { coverage: 999 })
    record('阈值越界被拒绝', badThreshold.status === 400 && badThreshold.payload.ok === false,
      badThreshold.payload.error ?? '')

    const goodThreshold = await call('PUT', '/api/v1/governance/config/thresholds', { coverage: 80, retry: 3, severity: 'CRITICAL' })
    record('阈值合法值保存成功', goodThreshold.ok && goodThreshold.payload.ok === true,
      goodThreshold.ok ? `G6 已同步为 ${goodThreshold.payload.thresholds?.gates?.G6_coverage?.minimum}` : '')

    const badYaml = await call('PUT', '/api/v1/governance/config/policy', { yaml: 'rules: [oops' })
    record('非法 YAML 被拒绝', badYaml.status === 400, badYaml.payload.error?.slice(0, 60) ?? '')

    // ---------------------------------------------------------------
    // 2) 任务生命周期
    // ---------------------------------------------------------------
    const created = await call('POST', '/api/v1/tasks', { name: '验收任务', level: 'M' })
    const taskId = created.payload?.task?.taskId
    record('创建任务', created.status === 201 && Boolean(taskId), taskId ?? JSON.stringify(created.payload).slice(0, 80))

    if (taskId) {
      const started = await call('POST', `/api/v1/tasks/${encodeURIComponent(taskId)}/start`, {})
      record('启动任务', started.ok && started.payload.task?.status === 'running', started.payload.task?.status ?? '')

      const checkpoint = await call('POST', `/api/v1/tasks/${encodeURIComponent(taskId)}/checkpoints`, { summary: '验收检查点' })
      record('写检查点', checkpoint.ok, checkpoint.payload.checkpoint?.summary ?? '')

      const noEvidence = await call('POST', `/api/v1/tasks/${encodeURIComponent(taskId)}/complete`, { outcome: 'complete', summary: '无证据完成尝试' })
      record('无验证证据完成被拒绝', noEvidence.status !== 200,
        noEvidence.payload.error?.slice(0, 70) ?? '')

      const completed = await call('POST', `/api/v1/tasks/${encodeURIComponent(taskId)}/complete`,
        { outcome: 'complete', summary: '验收完成', validation: ['verify-agent-dispatch.mjs'] })
      record('带证据完成任务', completed.ok && completed.payload.task?.status === 'completed',
        completed.payload.task?.status ?? '')
    }

    // ---------------------------------------------------------------
    // 3) 派发链路：agent-cli 执行器（真实子进程）
    // ---------------------------------------------------------------
    const configured = await call('PUT', `/api/agent-control/sessions/${encodeURIComponent(SESSION)}`, {
      mode: 'live-guarded',
      localExecutor: true,
      executor: 'agent-cli',
      agentCommand: `node ${stub.path} {prompt}`,
    })
    record('会话切到 agent-cli 执行器', configured.ok && configured.payload.session?.executor === 'agent-cli',
      `executor=${configured.payload.session?.executor ?? '?'} localExecutor=${configured.payload.session?.localExecutor ?? '?'}`)

    const sent = await call('POST', `/api/agent-control/sessions/${encodeURIComponent(SESSION)}/messages`,
      { text: '验收派发链路', dryRun: false, from: 'acceptance-script' })
    record('发送消息触发执行', sent.payload.willExecute === true,
      `status=${sent.payload.message?.status ?? '?'} claimedBy=${sent.payload.message?.claimedBy ?? '?'}`)

    let reply = null
    for (let attempt = 0; attempt < 20 && !reply; attempt += 1) {
      await sleep(500)
      const transcript = await call('GET', `/api/agent-control/sessions/${encodeURIComponent(SESSION)}/transcript?limit=10`)
      reply = [...(transcript.payload.messages ?? [])].reverse()
        .find(message => message.direction === 'agent-to-operator')
    }
    record('收到 agent 真实回复', Boolean(reply) && reply.text.includes('agent-stub received prompt'),
      reply ? reply.text.split('\n')[0] : '超时未收到回复')
    record('回复包含真实执行命令信息', Boolean(reply) && reply.text.includes('agent-stub.mjs'),
      reply ? (reply.text.match(/·\s*([^）]+)/)?.[1] ?? '') : '')

    // ---------------------------------------------------------------
    // 4) 失败路径
    // ---------------------------------------------------------------
    await call('PUT', `/api/agent-control/sessions/${encodeURIComponent(SESSION)}`, {
      agentCommand: `node ${stub.path} {prompt} --fail`,
    })
    const sentFail = await call('POST', `/api/agent-control/sessions/${encodeURIComponent(SESSION)}/messages`,
      { text: '验收失败路径', dryRun: false, from: 'acceptance-script' })
    let failReply = null
    for (let attempt = 0; attempt < 20 && !failReply; attempt += 1) {
      await sleep(500)
      const transcript = await call('GET', `/api/agent-control/sessions/${encodeURIComponent(SESSION)}/transcript?limit=6`)
      failReply = [...(transcript.payload.messages ?? [])].reverse()
        .find(message => message.direction === 'agent-to-operator' && message.text.includes('执行失败'))
    }
    record('失败路径回帖（含 stderr）', Boolean(failReply) && failReply.text.includes('refused'),
      failReply ? failReply.text.split('\n')[1]?.slice(0, 60) ?? '' : `sent=${sentFail.payload.message?.status ?? '?'}`)

    // ---------------------------------------------------------------
    // 5) 飞书桥接就绪度（不启动，只检查诊断是否准确）
    // ---------------------------------------------------------------
    const bridge = await call('GET', '/api/integrations/feishu/bridge')
    record('飞书桥接就绪度可诊断', bridge.ok && Array.isArray(bridge.payload.readiness?.blockers),
      bridge.payload.readiness?.ready
        ? '就绪'
        : `阻断项：${bridge.payload.readiness?.blockers?.join('；') ?? ''}`)

    // 复原：清掉验收用的命令覆盖
    await call('PUT', `/api/agent-control/sessions/${encodeURIComponent(SESSION)}`, { agentCommand: '' })
  } finally {
    rmSync(stub.dir, { recursive: true, force: true })
  }

  const passed = results.filter(r => r.passed).length
  console.log(`\n===== ${passed}/${results.length} 项通过 =====`)
  if (passed !== results.length) {
    console.log('未通过项：')
    for (const r of results.filter(x => !x.passed)) console.log(`  - ${r.name}: ${r.detail}`)
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(`验收脚本异常：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
