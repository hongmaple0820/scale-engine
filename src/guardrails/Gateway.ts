// SCALE Engine — Guardrails Gateway (W5 完整实现)
// Hook 网关 + 5 种懒惰检测器 + Role 权限
// 设计参考：docs/03-CORE-MODULES.md §3.5

import type { ToolUseInput, ToolResultInput, StopInput, GateDecision, DetectorResult } from '../artifact/types.js'
import type { IEventBus } from '../core/eventBus.js'
import { logger } from '../core/logger.js'

export interface IDetector {
  name: string
  check(input: ToolUseInput | ToolResultInput | StopInput, context: DetectorContext): Promise<DetectorResult>
}

export interface DetectorContext {
  eventBus: IEventBus
  cache: Map<string, unknown>
}

export interface IGateway {
  preTool(input: ToolUseInput): Promise<GateDecision>
  postTool(input: ToolResultInput): Promise<void>
  beforeStop(input: StopInput): Promise<GateDecision>
  registerDetector(detector: IDetector, hook: 'preTool' | 'postTool' | 'beforeStop'): void
}

export class Gateway implements IGateway {
  private cache = new Map<string, unknown>()
  private detectors = {
    preTool: [] as IDetector[],
    postTool: [] as IDetector[],
    beforeStop: [] as IDetector[],
  }

  constructor(private eventBus: IEventBus) {}

  registerDetector(detector: IDetector, hook: 'preTool' | 'postTool' | 'beforeStop'): void {
    this.detectors[hook].push(detector)
    logger.debug({ name: detector.name, hook }, 'Detector registered')
  }

  async preTool(input: ToolUseInput): Promise<GateDecision> {
    for (const det of this.detectors.preTool) {
      const result = await det.check(input, { eventBus: this.eventBus, cache: this.cache })
      if (result.triggered) {
        if (result.severity === 'deny' || result.severity === 'block') {
          this.eventBus.emit('tool.blocked', { tool: input.tool, detector: det.name, reason: result.reason }, { sessionId: input.sessionId })
          return { allow: false, reason: result.reason, suggestion: result.suggestion }
        }
        if (result.severity === 'warn') {
          return { allow: true, reason: result.reason, injectContext: [result.reason ?? ''] }
        }
      }
    }
    this.eventBus.emit('tool.called', { tool: input.tool, args: input.args }, { sessionId: input.sessionId })
    return { allow: true }
  }

  async postTool(input: ToolResultInput): Promise<void> {
    if (input.exitCode === 0) {
      this.eventBus.emit('tool.completed', { tool: input.tool, args: input.args, exitCode: input.exitCode, output: input.output }, { sessionId: input.sessionId })
    } else {
      this.eventBus.emit('tool.failed', { tool: input.tool, args: input.args, exitCode: input.exitCode, output: input.output }, { sessionId: input.sessionId })
    }
    for (const det of this.detectors.postTool) {
      await det.check(input, { eventBus: this.eventBus, cache: this.cache })
    }
  }

  async beforeStop(input: StopInput): Promise<GateDecision> {
    for (const det of this.detectors.beforeStop) {
      const result = await det.check(input, { eventBus: this.eventBus, cache: this.cache })
      if (result.triggered && (result.severity === 'deny' || result.severity === 'block')) {
        return { allow: false, reason: result.reason, suggestion: result.suggestion }
      }
    }
    return { allow: true }
  }
}
