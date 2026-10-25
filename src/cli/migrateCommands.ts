// scale migrate — .scale layout v2 migration (plan 2026-10-24 §3)
//
// Move flat .scale entries into the six buckets, leave compatibility
// junctions at every legacy path (129 hardcoded join sites keep working),
// write layout.json. --rollback reverses from the recorded report.

import { defineCommand } from 'citty'
import { join } from 'node:path'
import { migrateLayoutV2, rollbackLayoutV2, loadReport } from '../surface/LayoutMigration.js'
import { isLayoutV2 } from '../surface/ScaleSurface.js'

export const migrateCommand = defineCommand({
  meta: { name: 'migrate', description: 'Migrate the .scale/ layout (v2 buckets + compat links). Plan 2026-10-24' },
  args: {
    layout: { type: 'string', default: 'v2', description: 'Target layout: v2 (only v2 supported)' },
    rollback: { type: 'boolean', default: false, description: 'Reverse the last v2 migration' },
    dir: { type: 'string', default: '.', description: 'Project directory' },
  },
  async run({ args }) {
    const projectDir = String(args.dir || '.')
    const scaleDir = join(projectDir, '.scale')

    if (args.rollback) {
      const report = rollbackLayoutV2(projectDir, scaleDir)
      console.log(`\n↩️  已回滚 v2 迁移：${report.moved.length} 项移回扁平位置，兼容链接移除，layout.json 删除`)
      console.log('   evidence/specs/config 内容未做任何修改（只换了位置）。')
      return
    }

    if (args.layout !== 'v2') {
      console.error(`unsupported layout "${args.layout}" — only v2 exists`)
      process.exitCode = 1
      return
    }
    if (isLayoutV2(scaleDir)) {
      const existing = loadReport(scaleDir)
      console.log(`\n已是 v2 布局（migratedAt: ${existing?.migratedAt ?? 'unknown'}），无需迁移。`)
      return
    }

    const report = migrateLayoutV2(projectDir, scaleDir)
    console.log(`\n✅ .scale/ 已迁移到 v2 布局`)
    console.log(`   moved : ${report.moved.length} 项进入六桶（config/state/evidence/specs/reports/cache）`)
    console.log(`   links : ${report.links.length} 个旧扁平路径保留兼容 junction —— 旧代码路径不受影响`)
    if (report.skipped.length > 0) console.log(`   skip  : ${report.skipped.join(', ')}`)
    console.log(`\n   回滚：scale migrate --rollback`)
  },
})
