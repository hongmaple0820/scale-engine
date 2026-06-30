import { defineCommand } from 'citty'
import { quickStart, detectPlatform, classifyProject } from '../api/quickstart.js'
import { logger } from '../core/logger.js'

export const quickstartCommand = defineCommand({
  meta: {
    name: 'quickstart',
    description: 'One-command governance setup preview; use scale install for the guided customer install',
  },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    pack: { type: 'string', required: false, description: 'Governance pack (auto-detected if omitted)' },
    profile: { type: 'string', default: 'standard', description: 'Profile (minimal|standard|critical)' },
  },
  async run({ args }) {
    const classification = classifyProject(args.dir as string)
    const pack = (args.pack as string | undefined) ?? classification.recommendedPack

    logger.info({ pack, profile: args.profile, language: classification.language }, 'Quickstart initiated')

    const platform = detectPlatform(args.dir as string)

    console.log('\nSCALE Engine Quickstart\n')
    console.log(`  Project type: ${classification.language}${classification.framework ? ` (${classification.framework})` : ''}${classification.isMonorepo ? ' [monorepo]' : ''}`)
    console.log(`  Platform:     ${platform.platform ?? 'not detected (governance-only mode)'}`)
    console.log(`  Governance:   ${pack}`)
    console.log(`  Profile:      ${args.profile}\n`)

    const result = await quickStart(args.dir as string, {
      governancePack: pack,
      profileId: args.profile as string,
    })

    if (result.success) {
      console.log(`  Created: ${result.created.length} files`)
      console.log(`  Capabilities: ${result.capabilitiesEnabled.join(', ')}`)
      console.log('\n  Recommended install path:')
      console.log('    scale install --dir .')
      console.log('\n  Advanced/manual next steps:')
      for (const step of result.nextSteps) console.log(`    ${step}`)
      console.log('\n  Run scale preflight --preflight-profile quick --dir . when you need a focused verification pass.')
    } else {
      console.log('  Quickstart completed. Run scale install --dir . to configure the project.')
      for (const step of result.nextSteps) console.log(`    ${step}`)
    }
  },
})
