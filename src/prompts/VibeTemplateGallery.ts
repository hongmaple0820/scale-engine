export type VisualVibeTemplatePhase =
  | 'product'
  | 'research'
  | 'design'
  | 'architecture'
  | 'implementation'
  | 'verification'

export interface VisualVibeTemplate {
  id: string
  title: string
  phase: VisualVibeTemplatePhase
  role: string
  scenario: string
  bestFor: string[]
  scaleWorkflow: string[]
  suggestedSkills: string[]
  suggestedTools: string[]
  outputs: string[]
  coachingQuestions: string[]
  methodologyReferences?: string[]
  copyPrompt: string
}

export interface VibeTemplateRenderContext {
  appName?: string
  scenario?: string
  userRole?: string
}

export interface VisualVibePack {
  id: string
  name: string
  description: string
  templateIds: string[]
}

const DEFAULT_CONTEXT: Required<VibeTemplateRenderContext> = {
  appName: '你的项目',
  scenario: '请描述本次要解决的问题、目标用户和期望产出',
  userRole: '项目负责人',
}

export const VISUAL_VIBE_TEMPLATES: VisualVibeTemplate[] = [
  {
    id: 'product-ceo-discovery',
    title: 'CEO 产品闭环发现',
    phase: 'product',
    role: 'CEO / Product Strategist',
    scenario: '从模糊想法收敛到可执行产品目标',
    bestFor: ['新产品', '新功能', '需求模糊', '商业闭环不清楚'],
    scaleWorkflow: ['explore', 'plan', 'verify'],
    suggestedSkills: ['idea-refine', 'to-prd', 'deep-interview', 'product-manager'],
    suggestedTools: ['web-access', 'source citations'],
    outputs: ['mini-prd.md', 'acceptance-criteria.md', 'risk-map.md'],
    coachingQuestions: [
      '目标用户是谁，当前为什么必须解决这个问题？',
      '如果只上线一个最小闭环，必须包含哪三个能力？',
      '哪些需求现在看起来诱人，但应该明确列为非目标？',
    ],
    copyPrompt: `请作为 CEO 和产品负责人，主导 {{appName}} 的产品发现工作。

场景：{{scenario}}
我当前身份：{{userRole}}

请按 SCALE 工作流执行：
1. explore：先明确用户、业务目标、约束、竞品或替代方案，不确定的事实必须标注 [UNCERTAIN]。
2. plan：输出 Mini-PRD，包含用户路径、非目标、权限/数据影响、异常场景和验收标准。
3. verify：逐条检查成功标准是否可测试、是否能形成端到端闭环。

必须主动使用 skills/MCP/CLI：
- 如需联网资料，主动使用 web-access 或等价联网能力，并引用来源。
- 如需求模糊，主动使用 deep-interview / idea-refine 类 Skill。
- 如涉及用户界面，联动 UI/UX Skill 形成体验标准。

安全边界：
- 不允许凭空编造市场数据、竞品能力或用户需求。
- 不允许把临时想法写成确定需求。
- 不允许跳过权限、隐私、数据生命周期和失败场景。

成功标准：
- 产出一份可落地 Mini-PRD。
- 每条验收标准都能被测试或人工验证。
- 明确本阶段要做什么、不做什么、后续如何验证。`,
  },
  {
    id: 'ui-ux-design-direction',
    title: 'UI/UX 设计方向与审美校准',
    phase: 'design',
    role: 'UX Director / Visual Design Lead',
    scenario: '把功能需求转成可执行的界面体验方案',
    bestFor: ['界面设计', '交互体验', '视觉审美', '前端原型'],
    scaleWorkflow: ['explore', 'plan', 'build', 'verify'],
    suggestedSkills: ['awesome-design-md', 'ui-ux-pro-max', 'frontend-design', 'design-review'],
    suggestedTools: ['agent-browser', 'mcp-chrome-devtools', 'webapp-testing'],
    outputs: ['ui-spec.md', 'design-system-impact.md', 'visual-review.md'],
    coachingQuestions: [
      '用户在这个页面最频繁完成的动作是什么？',
      '界面应该更像运营后台、消费产品、创作工具，还是管理系统？',
      '哪些状态必须完整设计：空态、加载、错误、权限不足、移动端？',
    ],
    copyPrompt: `请作为 UX Director 和高级视觉设计负责人，主导 {{appName}} 的 UI/UX 方案。

场景：{{scenario}}
我当前身份：{{userRole}}

请按 SCALE 工作流执行：
1. explore：阅读现有产品、页面、组件、品牌和设计系统，识别当前视觉语言。
2. plan：输出 UI-SPEC，包含信息架构、核心用户路径、组件状态、响应式规则、可访问性要求。
3. build：只给出可执行设计方案或实现切片，不要写营销式空话。
4. verify：要求截图、浏览器检查、控制台/网络检查和移动端适配证据。

必须主动使用 skills/MCP/CLI：
- 设计方向用 awesome-design-md / ui-ux-pro-max / frontend-design。
- 浏览器验证用 agent-browser / Chrome DevTools MCP / webapp-testing。
- 如需真实网页或竞品参考，使用 web-access 并记录来源。

安全边界：
- 不允许默认套用紫蓝渐变、模板化卡片堆叠或无意义装饰。
- 不允许只描述功能而不定义状态、布局和交互。
- 不允许未验证截图就声称 UI 完成。

成功标准：
- 产出一份可以直接指导实现的 UI-SPEC。
- 每个关键页面包含状态、布局、交互、移动端和验收规则。
- 明确需要哪些浏览器证据证明体验达标。`,
  },
  {
    id: 'technical-architecture-plan',
    title: 'CTO 技术架构落地方案',
    phase: 'architecture',
    role: 'CTO / Principal Architect',
    scenario: '把产品目标转成模块边界、服务契约和验证策略',
    bestFor: ['技术方案', '架构设计', '模块边界', '跨服务协作'],
    scaleWorkflow: ['explore', 'plan', 'build', 'review', 'verify'],
    suggestedSkills: ['api-and-interface-design', 'documentation-and-adrs', 'code-review-and-quality'],
    suggestedTools: ['context7', 'rg', 'graphify', 'codex-cli', 'gemini-cli'],
    outputs: ['architecture-plan.md', 'api-contract.md', 'adr.md', 'verification-plan.md'],
    coachingQuestions: [
      '哪些模块是主链路，哪些只是适配层或临时支撑？',
      '哪些契约一旦变更会影响其他服务、前端或数据迁移？',
      '失败、回滚、兼容、观测和权限边界如何设计？',
    ],
    copyPrompt: `请作为 CTO 和首席架构师，主导 {{appName}} 的技术实现架构方案。

场景：{{scenario}}
我当前身份：{{userRole}}

请按 SCALE 工作流执行：
1. explore：先读现有代码、目录、模块文档、接口和验证命令，列出事实证据。
2. plan：输出架构方案，包含模块边界、接口契约、数据影响、异常契约、回滚策略和测试策略。
3. build：把方案拆成可独立验证的实现切片，避免一次性大爆炸改动。
4. review：主动做架构、代码质量、安全和文档影响评审。
5. verify：给出必须运行的命令、预期证据和无法验证时的降级说明。

必须主动使用 skills/MCP/CLI：
- 需要框架/SDK 当前用法时，主动查官方文档或 Context7。
- 需要模块关系时，使用 rg/graphify 或代码图谱能力。
- 需要交叉评审时，可使用 codex/gemini/opencode CLI，但必须记录版本、命令和输出摘要。
- 工具与 Skill 编排必须写入 skill-plan 或 verification 证据。

安全边界：
- 不允许编造调用链、接口或测试结果。
- 不允许绕过 ORM、框架约定、日志脱敏、安全校验和权限边界。
- 不允许把临时脚本、报告或调试日志混入长期资产。

成功标准：
- 产出一份可执行架构方案。
- 每个实现切片都有边界、风险、验证命令和回滚思路。
- 明确哪些文档需要长期维护，哪些产物是临时证据。`,
  },
  {
    id: 'agentic-company-operating-system',
    title: 'Agentic 公司化协作 SOP',
    phase: 'architecture',
    role: 'COO / Engineering Director / Agent Orchestrator',
    scenario: '把一次模糊任务编排成公司化、多角色、可审计的端到端流程',
    bestFor: ['多 Agent 协同', '复杂产品交付', '跨角色评审', '公司流程标准化', '长任务拆解'],
    scaleWorkflow: ['explore', 'plan', 'build', 'verify', 'review', 'ship', 'learn'],
    suggestedSkills: ['planning', 'code-reviewer', 'security-review', 'verification', 'documentation-and-adrs'],
    suggestedTools: ['scale agent plan', 'agent profiles', 'role perspectives', 'runtime evidence', 'gbrain memory', 'workflow effectiveness'],
    outputs: ['agent-collaboration.json', 'agent-sop.md', 'role-roster.md', 'handoff-contract.md', 'verification-plan.md', 'review-ledger.md'],
    methodologyReferences: [
      'MetaGPT: SOP and role-specialized multi-agent software workflow',
      'AutoGen: conversable agents and programmable conversation patterns',
      'CAMEL: role-playing agents with inception prompting',
      'AgentVerse: dynamic multi-agent collaboration',
      'ReAct: interleaved reasoning and tool action',
    ],
    coachingQuestions: [
      '这项工作需要哪些公司角色：CEO/PM/架构/前端/后端/QA/安全/发布/文档？',
      '哪些角色必须互审，哪些角色只是按需参与？',
      '每个阶段的 handoff contract、证据和退出条件是什么？',
    ],
    copyPrompt: `请作为 COO、Engineering Director 和 Agent Orchestrator，主导 {{appName}} 的 Agentic 公司化协作流程。

场景：{{scenario}}
我当前身份：{{userRole}}

请按 SCALE 工作流建立完整闭环：
1. explore：读取项目事实、现有 AGENTS/README/工作流文档、agent profiles、skills、gates、memory/knowledge 状态；不确定项标注 [UNCERTAIN]。
2. plan：优先运行或生成等价的机器可读计划：\`scale agent plan --task "{{scenario}}" --json\` 或 \`scale ai-os plan --task "{{scenario}}" --json\`；输出必须包含 agentCollaboration 的角色、DAG、handoff、review gates 和 token budget，再补 Agent SOP。
3. build：按最小可验证切片推进，只有在角色职责明确、证据路径明确后才进入实现。
4. verify：为每个角色产物绑定验证命令、检查表或人工验收证据。
5. review：组织互审，至少包含 eng-manager、qa-lead、security-reviewer；产品/UI/发布相关任务再加入 ceo-reviewer、design-reviewer、release-engineer。
6. ship：只在 required gates、review evidence、runtime evidence 和 release checklist 闭环后给出发布建议。
7. learn：把失败、修复、决策和可复用经验沉淀到 gbrain/知识库候选，但敏感信息必须脱敏且需要 review。

Agent 编排要求：
- 使用现有 agent presets：product-agent、architect-agent、frontend-agent、backend-agent、database-agent、test-agent、security-agent、performance-agent、docs-agent、ops-agent、code-review-agent。
- 为每个 agent 指定：目标、输入、输出、可用工具、禁止事项、最大 token/时间预算、何时升级给人类。
- 使用动态编排：小任务单 agent，大任务按 DAG/阶段编排；失败或高风险时升级到 reviewer/red-team。
- 避免“多 Agent 聊天消耗”：每个 agent 只拿与自己职责相关的最小上下文，输出必须结构化，禁止重复总结。

必须主动使用 skills/MCP/CLI：
- 用 planning / code-reviewer / security-review / verification / documentation-and-adrs 等 Skill 生成和审查产物。
- 用 runtime evidence、gates status、workflow effectiveness、ai-os status 或等价 CLI 证明闭环。
- 用 gbrain 召回项目经验，用知识库承载长期方法论，二者不要混用。

互审与监督：
- 每个关键产物至少经历 owner -> reviewer -> verifier 三段检查。
- reviewer 必须优先找 blocker、证据缺口、测试缺口、权限/安全风险、文档漂移。
- 如果 review 与 owner 结论冲突，输出 decision log：分歧、证据、采用方案、后续验证。

安全边界：
- 不允许让多 Agent 绕过人工确认、权限约束、发布门禁或安全审查。
- 不允许把未经验证的 agent 输出沉淀为长期规则、记忆或知识库事实。
- 不允许共享密钥、私有日志、用户数据或供应商凭证给无关 agent。

Token 与成本预算：
- 先给出预算计划：预估轮次、上下文上限、工具调用上限、是否需要外部联网/跨模型评审。
- 长文档先索引/摘要再读取；代码先结构化定位再打开文件；大图/大知识库先抽样再深入。
- 对低风险重复任务使用 fast/balanced；高风险架构、安全、发布才使用 powerful 或跨模型复核。

必须产出：
- agent-collaboration.json：由 scale agent plan / scale ai-os plan 生成或等价维护的机器可读角色、DAG、handoff、review gate 与预算计划。
- agent-sop.md：公司化角色流程和 SOP。
- role-roster.md：本任务实际启用/不启用的 agent 与理由。
- handoff-contract.md：每阶段交接物、验收标准和停止条件。
- verification-plan.md：命令、人工检查、证据路径。
- review-ledger.md：互审记录、冲突处理和最终准入结论。

成功标准：
- 任务从观察、计划、执行、验证、评审、发布、学习形成闭环。
- 每个 agent 都有清晰职责、上下文预算和退出条件。
- 没有无证据结论、无界多 Agent 消耗、未审查经验沉淀或绕过门禁。`,
  },
  {
    id: 'multi-agent-governed-delivery',
    title: '多 Agent 治理式交付编排',
    phase: 'implementation',
    role: 'Technical Program Manager / Agent Runtime Lead',
    scenario: '把复杂实现拆成可并行、可监督、可回滚的多 Agent 交付任务',
    bestFor: ['复杂实现', '并行工作流', '角色分工', '工具编排', '跨模块交付'],
    scaleWorkflow: ['explore', 'plan', 'build', 'verify', 'review'],
    suggestedSkills: ['planning', 'test-driven-development', 'code-reviewer', 'security-review', 'workflow-automator'],
    suggestedTools: ['scale agent plan', 'agent profiles', 'DAG plan', 'runtime evidence ledger', 'codegraph', 'test runner'],
    outputs: ['agent-collaboration.json', 'delivery-dag.md', 'agent-task-cards.md', 'sync-points.md', 'risk-register.md', 'verification.md'],
    methodologyReferences: [
      'AutoGen: programmable multi-agent conversation',
      'AgentVerse: dynamic agent group composition',
      'MetaGPT: assembly-line style specialized roles',
      'ReAct: tool-grounded action loop',
    ],
    coachingQuestions: [
      '哪些任务可以并行，哪些必须串行等待契约冻结？',
      '每个 agent 的最小上下文是什么，怎样避免共享全量仓库？',
      '哪些同步点需要人工决策或门禁阻断？',
    ],
    copyPrompt: `请作为 Technical Program Manager 和 Agent Runtime Lead，编排 {{appName}} 的多 Agent 治理式交付。

场景：{{scenario}}
我当前身份：{{userRole}}

请先不要直接写代码。先完成以下编排；如果可以使用 CLI，优先运行 \`scale agent plan --task "{{scenario}}" --json\` 生成 agentCollaboration 作为角色/DAG/预算的事实源：
1. 事实收集：读取现有代码/文档/测试/门禁，列出任务边界和不确定项。
2. DAG 拆解：把任务拆成可并行的 agent task cards，每张卡包含输入、输出、依赖、验证方式、预算和回滚。
3. Agent 选型：从现有 profile 中选择最少必要 agent；解释不用哪些 agent，避免编排过度。
4. 同步机制：定义 contract freeze、review gate、verify gate、ship gate 的同步点。
5. 证据机制：每个 agent 的输出必须映射到文件、命令、截图、runtime evidence 或 review 记录。

建议 agent 角色：
- product-agent：用户价值、范围、非目标。
- architect-agent：边界、契约、数据影响、回滚。
- frontend-agent/backend-agent/database-agent：实现切片。
- test-agent：TDD、回归、E2E、边界条件。
- security-agent：权限、输入、密钥、路径、依赖风险。
- performance-agent：大数据、长任务、缓存、性能预算。
- docs-agent：文档入口和长期知识沉淀。
- code-review-agent：最终质量和风险评审。

编排纪律：
- 小任务默认单 agent；只有跨角色风险明确时才开多 agent。
- 每个 agent 输出不超过一个明确 artifact；不要让多个 agent 重复产出同一文档。
- 每个 agent 在自己的预算内先给出“需要更多上下文吗”的判断；需要时说明具体文件/数据，不允许泛读。
- 失败时执行恢复策略：记录失败证据 -> 定位 root cause -> 分派修复 owner -> 回归验证 -> 标记 resolved。

安全边界：
- 不允许并行 agent 同时修改同一契约文件、迁移、权限策略或发布配置。
- 不允许用外部 agent 处理敏感数据，除非任务明确授权且经过安全检查。
- 不允许把“agent 说完成”当作完成；必须有验证证据。

必须主动使用 skills/MCP/CLI：
- 用 planning / test-driven-development / code-reviewer / security-review / workflow-automator 等 Skill。
- 用 codegraph/rg 定位影响面，用测试 runner/build/lint/gates 验证交付。
- 用 runtime evidence ledger 或 verification artifact 记录每个 agent 的关键结果。

Token 预算：
- 总预算分为 explore 20%、plan 20%、build 30%、verify/review 25%、summary 5%。
- 超预算时优先保留验证、review、ship evidence，压缩背景讨论。
- 对跨模型/外部 agent review 设置硬上限：只发送 diff、风险摘要、测试结果，不发送全量历史。

输出格式：
- agent-collaboration.json：由 scale agent plan / scale ai-os plan 生成或等价维护的机器可读角色、DAG、handoff、review gate 与预算计划。
- delivery-dag.md：任务图、依赖、并行策略。
- agent-task-cards.md：每个 agent 的输入/输出/预算/退出条件。
- sync-points.md：冻结点、门禁、人工决策点。
- risk-register.md：风险、owner、缓解、验证。
- verification.md：真实命令和证据路径。

成功标准：
- 多 Agent 协同减少风险和等待，而不是增加聊天噪音。
- 每个 agent 都有可验证产出和监督者。
- verify/review/ship 前没有开放的 blocker 或未解释的证据缺口。`,
  },
  {
    id: 'mutual-review-red-team-loop',
    title: '互审红队与自我修正闭环',
    phase: 'verification',
    role: 'Quality Director / Red Team Lead',
    scenario: '用互审、自我反馈和红队检查减少幻觉、遗漏和不合规交付',
    bestFor: ['高风险评审', '幻觉控制', '安全审计', '发布前复核', '复杂决策复盘'],
    scaleWorkflow: ['explore', 'plan', 'verify', 'review', 'revise', 'verify', 'ship'],
    suggestedSkills: ['code-reviewer', 'security-review', 'systematic-debugging', 'verification', 'memory-learning'],
    suggestedTools: ['runtime evidence', 'review ledger', 'gates status', 'gbrain memory', 'workflow effectiveness'],
    outputs: ['review.md', 'red-team-findings.md', 'revision-log.md', 'evidence-gap-report.md', 'learning-candidates.md'],
    methodologyReferences: [
      'Self-Refine: feedback and iterative refinement',
      'Reflexion: verbal feedback and episodic memory',
      'ReAct: action feedback reduces hallucination',
      'MetaGPT: specialized roles verify intermediate artifacts',
    ],
    coachingQuestions: [
      '哪些结论是事实、推断、计划或未验证假设？',
      '哪些失败证据已经被 resolved/pass 闭环？',
      '哪些经验可以进入记忆/知识库，哪些必须丢弃或脱敏？',
    ],
    copyPrompt: `请作为 Quality Director 和 Red Team Lead，对 {{appName}} 执行互审红队与自我修正闭环。

场景：{{scenario}}
我当前身份：{{userRole}}

请按以下循环执行，不要一次性给最终结论：
1. explore：列出已有事实、命令、测试、截图、文档、runtime evidence、gate evidence。
2. plan：制定互审角色、红队范围、预算、停止条件和证据路径。
3. verify：先跑可用验证，区分真实失败、缺证据和未运行。
4. review：用 eng-manager、qa-lead、security-reviewer、release-engineer 视角各自找 blocker。
5. revise：把每个 blocker 变成 owner + 修复动作 + 验证命令。
6. re-verify：只在证据更新后关闭 blocker；不能关闭时保留 open risk。
7. learn：将可复用经验写成 learning candidate，必须包含 evidence path、适用边界和 review 状态。

必须主动使用 skills/MCP/CLI：
- 使用 code-reviewer / security-review / verification / systematic-debugging 等 Skill。
- 使用 gates status、runtime evidence、测试命令、浏览器/截图证据或发布检查命令。
- 需要召回历史失败模式时使用 gbrain；需要长期方法论时查知识库。

互相监督规则：
- owner 不能直接批准自己的高风险产物。
- reviewer 必须先列 blocker，再列 improvement，最后才列 nit。
- 如果找不到问题，也必须说明检查范围和剩余风险。
- 所有“已修复”必须指向新的验证证据，不能只写解释。

幻觉控制：
- 每个外部事实必须有来源或标注 [UNVERIFIED]。
- 每个代码事实必须能指向文件/符号/命令输出。
- 不允许说“测试通过”除非真实运行并记录命令。
- 不允许把推断、计划、愿望写成现状。

安全边界：
- 不允许 reviewer 批准自己负责的高风险修复。
- 不允许把未审查经验直接写成强约束规则。
- 不允许泄露密钥、私有日志、用户数据或供应商凭证到 review/learning 产物。

Token 预算：
- 优先审查 diff、失败日志、门禁输出和风险摘要。
- 不重复复述大段上下文；每轮输出只保留 blocker table、decision log 和 next action。
- 超预算时停止新增 reviewer，先完成当前 blocker 的验证闭环。

输出格式：
- review.md：按 severity 排序的发现。
- red-team-findings.md：高风险攻击/失效路径。
- revision-log.md：修复前后证据。
- evidence-gap-report.md：仍缺什么证据。
- learning-candidates.md：可进入 gbrain/知识库的经验候选。

成功标准：
- blocker 都有 passed/resolved 证据或明确 open risk。
- 关键结论可追溯，未验证项没有被包装成完成。
- 经验沉淀不会引入错误规则、敏感信息或过期上下文。`,
  },
  {
    id: 'budget-aware-long-task-autopilot',
    title: '预算感知长任务推进',
    phase: 'implementation',
    role: 'Autonomous Delivery Lead / Cost Controller',
    scenario: '在长时间任务中控制 token、上下文、工具调用和恢复成本',
    bestFor: ['长任务', '自动推进', 'token 控制', '上下文压缩', '断点恢复', '多轮验证'],
    scaleWorkflow: ['explore', 'plan', 'build', 'verify', 'review', 'checkpoint', 'resume'],
    suggestedSkills: ['autopilot', 'checkpoint', 'verification', 'memory-learning', 'workflow-automator'],
    suggestedTools: ['model usage ledger', 'runtime evidence ledger', 'gbrain memory', 'task checkpoint', 'git diff'],
    outputs: ['budget-plan.md', 'checkpoint.md', 'progress-ledger.md', 'resume-context.md', 'cost-risk-report.md'],
    methodologyReferences: [
      'FrugalGPT: prompt adaptation and model cascade for cost control',
      'Reflexion: memory-backed recovery after feedback',
      'ReAct: observation-action-feedback loop',
      'Self-Refine: bounded iterative improvement',
    ],
    coachingQuestions: [
      '任务最大 token/时间/工具调用预算是多少？',
      '什么时候应 checkpoint、压缩上下文或请求人工决策？',
      '哪些证据必须保留，哪些中间讨论可以丢弃？',
    ],
    copyPrompt: `请作为 Autonomous Delivery Lead 和 Cost Controller，推进 {{appName}} 的长任务，但必须严格控制预算和闭环质量。

场景：{{scenario}}
我当前身份：{{userRole}}

先建立预算：
- token budget：为 explore/plan/build/verify/review/final 分配比例。
- tool budget：列出预计命令、浏览器、联网、外部 agent、构建/测试次数上限。
- time budget：定义每个阶段的停止条件。
- risk budget：定义什么时候必须升级到人工确认或跨角色 review。

执行循环：
1. Observe：读取最小必要上下文和最新 git/status/evidence。
2. Decide：选择下一步最小可验证动作，说明为什么现在做它。
3. Act：运行工具或修改文件；每次动作都必须产生可记录结果。
4. Feedback：读取命令/测试/浏览器/门禁反馈。
5. Recover：失败时保留失败证据，定位原因，修复后用新证据关闭。
6. Stop/Resume：达到阶段目标、预算上限或阻塞条件时写 checkpoint。

必须主动使用 skills/MCP/CLI：
- 使用 autopilot / checkpoint / verification / memory-learning / workflow-automator 等 Skill。
- 用 model usage ledger 或 token report 检查预算；用 runtime evidence ledger 记录关键验证。
- 用 git diff、测试命令、构建命令、浏览器检查和 gates status 形成可审计证据。

上下文压缩：
- 每轮只保留：目标、当前假设、已改文件、验证结果、open blockers、下一步。
- 大文档先目录/摘要，必要时按章节读取。
- 大代码库先结构搜索/调用关系，再打开具体文件。
- 外部资料只保留结论、URL、访问日期和影响决策的事实。

模型与 agent 选择：
- 低风险重复检查用 fast。
- 实现和排错用 balanced。
- 架构、安全、发布、重大不确定性用 powerful 或 reviewer。
- 不要为了“看起来强”启动多 Agent；必须说明每个 agent 如何降低风险或节省时间。

记忆与知识库：
- gbrain 用于召回项目经验、失败模式和已审结论。
- 知识库用于长期方法论、设计原则、架构决策和可引用资料。
- 新经验进入 memory/knowledge 前必须写 evidence path、适用条件、过期风险。

安全边界：
- 不允许为了自动推进跳过人工确认、权限边界、发布门禁或安全审查。
- 不允许把压缩摘要当成唯一事实源；关键结论必须能回链到证据。
- 不允许把失败命令覆盖成成功叙述，失败必须保留并闭环。

输出格式：
- budget-plan.md：预算、限制、升级条件。
- progress-ledger.md：每个动作的输入、输出、证据和成本。
- checkpoint.md：可恢复上下文，不依赖聊天历史。
- resume-context.md：下一轮最小上下文。
- cost-risk-report.md：预算使用、节省、超支风险。

成功标准：
- 长任务可以中断、恢复、审计。
- token 消耗有预算和压缩策略。
- 所有完成声明都有 evidence，所有未完成项有 open blocker 或下一步。`,
  },
  {
    id: 'implementation-slice',
    title: '工程实现切片',
    phase: 'implementation',
    role: 'Engineering Lead / Senior Developer',
    scenario: '把方案转成小步提交、测试和证据',
    bestFor: ['功能开发', 'Bug 修复', '重构', '多文件变更'],
    scaleWorkflow: ['explore', 'plan', 'build', 'verify'],
    suggestedSkills: ['test-driven-development', 'incremental-implementation', 'debugging-and-error-recovery'],
    suggestedTools: ['rg', 'test runner', 'lint', 'typecheck'],
    outputs: ['plan.md', 'verification.md', 'review.md'],
    coachingQuestions: [
      '最小可验证切片是什么？',
      '哪些同类问题需要一起扫描，但不一定一起修改？',
      '验证失败时如何定位是实现问题、环境问题还是既有债务？',
    ],
    copyPrompt: `请作为 Engineering Lead，主导 {{appName}} 的实现切片。

场景：{{scenario}}
我当前身份：{{userRole}}

请按 SCALE 工作流执行：
1. explore：读相关代码、测试、规范和历史上下文，输出影响面。
2. plan：把工作拆成最小实现切片，每个切片有文件范围和验证方式。
3. build：优先 TDD 或补回归测试，保持改动可追溯。
4. verify：运行真实命令，记录 exit code、失败项、修复迭代和未验证项。

必须主动使用 skills/MCP/CLI：
- 新逻辑或 Bug 修复使用 TDD / systematic-debugging。
- 多文件变更使用 incremental-implementation。
- 需要外部工具时先做安全扫描，再执行。

安全边界：
- 不允许随手重构无关代码。
- 不允许增加无脱敏日志、硬编码密钥、危险默认值或绕过框架约定。
- 不允许测试未运行却声称通过。

成功标准：
- 改动范围和用户请求可追溯。
- 必要测试、lint、构建或人工验证有证据。
- 交付说明包含完成内容、验证结果和未验证项。`,
  },
  {
    id: 'verification-release',
    title: '验收与发版前检查',
    phase: 'verification',
    role: 'QA Lead / Release Manager',
    scenario: '在交付、合并或发版前收敛证据和风险',
    bestFor: ['验收', '发版', 'PR 前检查', '生产级交付'],
    scaleWorkflow: ['explore', 'plan', 'verify', 'review', 'ship'],
    suggestedSkills: ['verification', 'code-reviewer', 'security-and-hardening', 'shipping-and-launch'],
    suggestedTools: ['make gate', 'npm run build', 'npx vitest run', 'git diff --check'],
    outputs: ['verification.md', 'review.md', 'release-notes.md', 'metrics.md'],
    coachingQuestions: [
      '哪些路径已经真实验证，哪些只是静态检查？',
      '失败和跳过项是否被明确记录？',
      '是否存在临时文件、测试报告、截图或日志不应提交？',
    ],
    copyPrompt: `请作为 QA Lead 和 Release Manager，主导 {{appName}} 的验收与发版前检查。

场景：{{scenario}}
我当前身份：{{userRole}}

请按 SCALE 工作流执行：
1. explore：读取当前任务产物、git diff、测试配置和已知风险。
2. verify：运行最小相关验证和发版前门控，记录真实输出摘要。
3. review：执行代码质量、安全、文档资产和资源治理检查。
4. ship：只有证据闭环后才建议合并、打 tag 或发布。

必须主动使用 skills/MCP/CLI：
- 使用 verification / code-reviewer / security review 类 Skill。
- UI 或浏览器功能必须补截图、控制台和网络证据。
- 发版必须记录版本、commit、tag、registry 或远程状态。

安全边界：
- 不允许隐藏失败命令。
- 不允许把 dry-run 当成真实通过。
- 不允许提交临时脚本、敏感日志、未归档测试报告或本地配置。

成功标准：
- 产出完整 verification/review/release evidence。
- 所有 required gates 通过，optional gates 的缺失有说明。
- 明确是否可发版，以及剩余风险。`,
  },
]

export const VISUAL_VIBE_PACKS: VisualVibePack[] = [
  {
    id: 'full-mvp',
    name: '完整 MVP + Agentic 闭环',
    description: '从产品发现、UI、架构、公司化 Agent SOP、多 Agent 交付、互审到发版的完整流程。',
    templateIds: [
      'product-ceo-discovery',
      'ui-ux-design-direction',
      'technical-architecture-plan',
      'agentic-company-operating-system',
      'multi-agent-governed-delivery',
      'implementation-slice',
      'mutual-review-red-team-loop',
      'verification-release',
    ],
  },
  {
    id: 'quick-prototype',
    name: '快速原型闭环',
    description: '用最少模板完成产品澄清、实现切片和验收闭环。',
    templateIds: [
      'product-ceo-discovery',
      'implementation-slice',
      'verification-release',
    ],
  },
  {
    id: 'developer-path',
    name: '开发者交付路径',
    description: '面向有经验开发者的架构、实现、验证与发版路径。',
    templateIds: [
      'technical-architecture-plan',
      'implementation-slice',
      'verification-release',
    ],
  },
  {
    id: 'vibe-coder-path',
    name: 'Vibe Coder 路径',
    description: '面向初学者或非工程背景用户的产品、设计和实现引导。',
    templateIds: [
      'product-ceo-discovery',
      'ui-ux-design-direction',
      'implementation-slice',
    ],
  },
  {
    id: 'agentic-company-flow',
    name: 'Agentic 公司流程',
    description: '公司化角色 SOP、多 Agent 编排、互审监督和发版闭环。',
    templateIds: [
      'product-ceo-discovery',
      'agentic-company-operating-system',
      'multi-agent-governed-delivery',
      'mutual-review-red-team-loop',
      'verification-release',
    ],
  },
  {
    id: 'multi-agent-delivery',
    name: '多 Agent 治理交付',
    description: '复杂实现的动态 agent 选型、DAG 编排、预算控制和互审闭环。',
    templateIds: [
      'agentic-company-operating-system',
      'multi-agent-governed-delivery',
      'budget-aware-long-task-autopilot',
      'mutual-review-red-team-loop',
    ],
  },
  {
    id: 'long-task-autopilot',
    name: '预算感知长任务',
    description: '长任务自动推进、checkpoint、token 预算、恢复和证据闭环。',
    templateIds: [
      'budget-aware-long-task-autopilot',
      'implementation-slice',
      'mutual-review-red-team-loop',
      'verification-release',
    ],
  },
]

export function listVisualVibeTemplates(): VisualVibeTemplate[] {
  return [...VISUAL_VIBE_TEMPLATES]
}

export function listVisualVibePacks(): VisualVibePack[] {
  return [...VISUAL_VIBE_PACKS]
}

export function getVisualVibeTemplate(id: string): VisualVibeTemplate | undefined {
  return VISUAL_VIBE_TEMPLATES.find(template => template.id === id)
}

export function renderCopyablePromptCard(id: string, context: VibeTemplateRenderContext = {}): string {
  const template = getVisualVibeTemplate(id)
  if (!template) return ''
  const resolved = resolveContext(context)
  const prompt = interpolate(template.copyPrompt, resolved)
  return [
    `## ${template.title}`,
    '',
    `- ID: \`${template.id}\``,
    `- 角色: ${template.role}`,
    `- 场景: ${template.scenario}`,
    `- SCALE 阶段: ${template.scaleWorkflow.join(' -> ')}`,
    `- 推荐 Skills: ${template.suggestedSkills.join(', ')}`,
    `- 推荐工具: ${template.suggestedTools.join(', ')}`,
    `- 预期产物: ${template.outputs.join(', ')}`,
    ...(template.methodologyReferences?.length
      ? [`- 方法论依据: ${template.methodologyReferences.join('; ')}`]
      : []),
    '',
    '### 引导问题',
    ...template.coachingQuestions.map(question => `- ${question}`),
    '',
    '### 复制使用',
    '',
    '```text',
    prompt,
    '```',
    '',
  ].join('\n')
}

export function renderVisualVibeTemplateIndex(context: VibeTemplateRenderContext = {}): string {
  const resolved = resolveContext(context)
  const lines = [
    '# SCALE Vibe Coding 可视化提示词模板',
    '',
    `项目: ${resolved.appName}`,
    '',
    '这组模板把 Vibe Coding 的快速表达方式和 SCALE 的工程闭环合在一起：先澄清目标，再编排 skills/MCP/CLI，再产出可验证证据。',
    '',
    '## 使用方式',
    '',
    '- 查看模板: `scale vibe-index`',
    '- 复制单个模板: `scale vibe --template <template-id> --app "项目名"`',
    '- 保存到文件: `scale vibe --template <template-id> --output docs/prompts/<name>.md`',
    '',
    '## 组合包',
    '',
    '| Pack ID | 名称 | 说明 | 模板 |',
    '| --- | --- | --- | --- |',
  ]

  for (const pack of VISUAL_VIBE_PACKS) {
    lines.push(`| \`${pack.id}\` | ${pack.name} | ${pack.description} | ${pack.templateIds.map(id => `\`${id}\``).join(', ')} |`)
  }

  lines.push(
    '',
    '## 模板总览',
    '',
    '| Template ID | 标题 | 角色 | 阶段 | 推荐 Skills |',
    '| --- | --- | --- | --- | --- |',
  )

  for (const template of VISUAL_VIBE_TEMPLATES) {
    lines.push(`| \`${template.id}\` | ${template.title} | ${template.role} | ${template.phase} | ${template.suggestedSkills.join(', ')} |`)
  }

  lines.push('', '## 复制区', '')
  for (const template of VISUAL_VIBE_TEMPLATES) {
    lines.push(renderCopyablePromptCard(template.id, resolved))
  }
  return lines.join('\n')
}

function resolveContext(context: VibeTemplateRenderContext): Required<VibeTemplateRenderContext> {
  return {
    appName: context.appName?.trim() || DEFAULT_CONTEXT.appName,
    scenario: context.scenario?.trim() || DEFAULT_CONTEXT.scenario,
    userRole: context.userRole?.trim() || DEFAULT_CONTEXT.userRole,
  }
}

function interpolate(value: string, context: Required<VibeTemplateRenderContext>): string {
  return value
    .replace(/\{\{appName\}\}/g, context.appName)
    .replace(/\{\{scenario\}\}/g, context.scenario)
    .replace(/\{\{userRole\}\}/g, context.userRole)
}
