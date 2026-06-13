import { logger } from '../core/logger.js'
import { DashboardServer } from '../dashboard/DashboardServer.js'
import { resolveDashboardLaunchPlan } from './DashboardHttpConfig.js'

async function main(): Promise<void> {
  const plan = await resolveDashboardLaunchPlan(process.env, process.cwd())
  const servers: DashboardServer[] = []

  for (const project of plan.projects) {
    const server = new DashboardServer({
      port: project.port,
      host: project.host,
      projectDir: project.projectDir,
      scaleDir: project.scaleDir,
      projectName: project.name,
      projectUrl: project.url,
      currentProjectId: project.id,
      projects: plan.projects,
    })
    await server.start()
    servers.push(server)
    logger.info({
      project: project.name,
      projectDir: project.projectDir,
      port: project.port,
      url: project.url,
    }, 'Dashboard project started')
  }

  printDashboardUrls(plan.projects)

  const stop = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Stopping dashboard server')
    for (const server of servers) server.stop()
    process.exit(0)
  }

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

main().catch((error) => {
  logger.error({ error }, 'Dashboard server failed')
  process.exit(1)
})

function printDashboardUrls(projects: Array<{ name: string; url: string; projectDir: string }>): void {
  const lines = [
    '',
    'SCALE Dashboard is running:',
    ...projects.map(project => `- ${project.name}: ${project.url}/spa/ (${project.projectDir})`),
    '',
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}
