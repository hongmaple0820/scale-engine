// SCALE Engine — Meta-Governance Commands (G9-G15)
import { defineCommand } from 'citty'
import { join } from 'node:path'
import { EventBus } from '../core/eventBus.js'

export const metaGovernanceCommand = defineCommand({
  meta: { name: 'meta-governance', description: 'Run meta-governance gates (G9-G15) — check if governance capabilities are actually used' },
  args: {
    'scale-dir': { type: 'string', default: '.scale' },
    json: { type: 'boolean', default: false, description: 'Output as JSON' },
  },
  async run({ args }) {
    const scaleDir = String(args['scale-dir'] ?? '.scale')
    const eventBus = new EventBus({ eventsDir: join(scaleDir, 'events') })
    const { GateSystem } = await import('../workflow/gates/GateSystem.js')
    const gateSystem = new GateSystem(eventBus, { scaleDir, cwd: process.cwd() })
    const results = await gateSystem.executeMetaGovernance(scaleDir)

    if (args.json) {
      console.log(JSON.stringify(results, null, 2))
      return
    }

    const stageNames: Record<string, string> = {
      G9: 'Knowledge Utilization',
      G10: 'Evolution Effectiveness',
      G11: 'Guardrail Effectiveness',
      G12: 'Workflow Thoroughness',
      G13: 'Multi-Agent Coordination',
      G14: 'Skill Utilization',
      G15: 'Self-Improvement',
    }

    let allPassed = true
    for (const result of results) {
      const icon = result.passed ? '✅' : '❌'
      const name = stageNames[result.gate] ?? result.gate
      console.log(`${icon} ${result.gate} ${name}`)
      if (result.evidence) {
        for (const line of result.evidence.split('\n')) {
          console.log(`   ${line}`)
        }
      }
      if (!result.passed) {
        allPassed = false
        for (const blocker of result.blockers) {
          console.log(`   ⛔ ${blocker}`)
        }
      }
      console.log()
    }

    if (!allPassed) {
      console.log('❌ Meta-governance check FAILED — some capabilities are not being effectively used')
      process.exit(1)
    } else {
      console.log('✅ All meta-governance gates passed')
    }
  },
})
