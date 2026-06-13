import { describe, expect, it } from 'vitest'
import { inspectEnvironment } from '../../src/env/EnvironmentDoctor.js'

describe('inspectEnvironment', () => {
  it('treats recall-ready gbrain doctor output as healthy even when optional checks fail', () => {
    const report = inspectEnvironment({
      env: {
        PATH: 'C:\\tools',
      },
      nodeVersion: 'v22.13.1',
      execPath: 'C:\\node\\node.exe',
      platform: 'win32',
      arch: 'x64',
      release: '10.0.19045',
      commandResolver(command) {
        const known = new Set(['git', 'npm', 'npx', 'gbrain'])
        return known.has(command) ? `C:\\tools\\${command}.cmd` : null
      },
      commandRunner(command, args) {
        if (command === 'gbrain') {
          if (args[0] === '--version') {
            return {
              exitCode: 0,
              stdout: 'gbrain 0.34.3',
              stderr: '',
            }
          }
          return {
            exitCode: 1,
            stdout: JSON.stringify({
              status: 'unhealthy',
              checks: [
                { name: 'connection', status: 'ok' },
                { name: 'schema_version', status: 'ok' },
                { name: 'resolver_health', status: 'fail' },
                { name: 'embeddings', status: 'warn' },
              ],
            }),
            stderr: '',
          }
        }
        return {
          exitCode: 0,
          stdout: `${command} 1.0.0`,
          stderr: '',
        }
      },
    })

    const gbrain = report.checks.find(check => check.id === 'gbrain')
    expect(gbrain).toBeDefined()
    expect(gbrain?.status).toBe('ok')
    expect(gbrain?.version).toBe('gbrain 0.34.3')
    expect(gbrain?.reason).toContain('GBrain core recall is available; optional doctor warnings: resolver_health, embeddings')
    expect(gbrain?.reason).not.toContain('{"status":"unhealthy"')
    expect(report.warnings).not.toContain(`gbrain: ${gbrain?.reason}`)
    expect(report.status).toBe('healthy')
  })

  it('accepts current gbrain doctor output without legacy schema checks when connection is ok', () => {
    const report = inspectEnvironment({
      env: {
        PATH: 'C:\\tools',
      },
      nodeVersion: 'v22.13.1',
      execPath: 'C:\\node\\node.exe',
      platform: 'win32',
      arch: 'x64',
      release: '10.0.19045',
      commandResolver(command) {
        const known = new Set(['git', 'npm', 'npx', 'gbrain'])
        return known.has(command) ? `C:\\tools\\${command}.cmd` : null
      },
      commandRunner(command, args) {
        if (command === 'gbrain') {
          if (args[0] === '--version') {
            return {
              exitCode: 0,
              stdout: 'gbrain 0.41.14.0',
              stderr: '',
            }
          }
          return {
            exitCode: 1,
            stdout: JSON.stringify({
              status: 'warnings',
              checks: [
                { name: 'connection', status: 'ok' },
                { name: 'resolver_health', status: 'warn' },
              ],
            }),
            stderr: '',
          }
        }
        return {
          exitCode: 0,
          stdout: `${command} 1.0.0`,
          stderr: '',
        }
      },
    })

    const gbrain = report.checks.find(check => check.id === 'gbrain')
    expect(gbrain).toBeDefined()
    expect(gbrain?.status).toBe('ok')
    expect(gbrain?.version).toBe('gbrain 0.41.14.0')
    expect(gbrain?.reason).toContain('GBrain core recall is available; optional doctor warnings: resolver_health')
    expect(report.warnings).not.toContain(`gbrain: ${gbrain?.reason}`)
  })

  it('summarizes gbrain core recall failures instead of dumping raw JSON', () => {
    const report = inspectEnvironment({
      env: {
        PATH: 'C:\\tools',
      },
      nodeVersion: 'v22.13.1',
      execPath: 'C:\\node\\node.exe',
      platform: 'win32',
      arch: 'x64',
      release: '10.0.19045',
      commandResolver(command) {
        const known = new Set(['git', 'npm', 'npx', 'gbrain'])
        return known.has(command) ? `C:\\tools\\${command}.cmd` : null
      },
      commandRunner(command, args) {
        if (command === 'gbrain') {
          if (args[0] === '--version') {
            return {
              exitCode: 0,
              stdout: 'gbrain 0.34.3',
              stderr: '',
            }
          }
          return {
            exitCode: 1,
            stdout: JSON.stringify({
              status: 'unhealthy',
              checks: [
                { name: 'connection', status: 'fail' },
                { name: 'schema_version', status: 'warn' },
                { name: 'resolver_health', status: 'fail' },
              ],
            }),
            stderr: '',
          }
        }
        return {
          exitCode: 0,
          stdout: `${command} 1.0.0`,
          stderr: '',
        }
      },
    })

    const gbrain = report.checks.find(check => check.id === 'gbrain')
    expect(gbrain).toBeDefined()
    expect(gbrain?.status).toBe('warn')
    expect(gbrain?.version).toBe('gbrain 0.34.3')
    expect(gbrain?.reason).toContain('gbrain doctor reported core recall issue(s): connection, schema_version')
    expect(gbrain?.reason).not.toContain('{"status":"unhealthy"')
    expect(report.warnings).toContain(`gbrain: ${gbrain?.reason}`)
  })

  it('treats the Windows bash launcher as missing when no usable runtime is configured', () => {
    const report = inspectEnvironment({
      env: {
        PATH: 'C:\\tools',
      },
      nodeVersion: 'v22.13.1',
      execPath: 'C:\\node\\node.exe',
      platform: 'win32',
      arch: 'x64',
      release: '10.0.19045',
      commandResolver(command) {
        const known = new Map([
          ['git', 'C:\\tools\\git.cmd'],
          ['npm', 'C:\\tools\\npm.cmd'],
          ['npx', 'C:\\tools\\npx.cmd'],
          ['bash', 'C:\\Windows\\System32\\bash.exe'],
        ])
        return known.get(command) ?? null
      },
      commandRunner(command) {
        if (command === 'bash') {
          return {
            exitCode: 1,
            stdout: '',
            stderr: '',
          }
        }
        return {
          exitCode: 0,
          stdout: `${command} 1.0.0`,
          stderr: '',
        }
      },
    })

    const bash = report.checks.find(check => check.id === 'bash')
    expect(bash).toBeDefined()
    expect(bash?.status).toBe('missing')
    expect(bash?.reason).toContain('no usable Bash runtime is configured')
    expect(report.warnings.some(warning => warning.includes('bash'))).toBe(false)
    expect(report.status).toBe('healthy')
  })
})
