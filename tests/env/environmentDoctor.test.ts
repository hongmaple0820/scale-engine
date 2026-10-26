import { describe, expect, it } from 'vitest'
import { inspectEnvironment, probeNativeModule } from '../../src/env/EnvironmentDoctor.js'

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
      // The subject here is gbrain recall readiness, not this machine's ABI.
      nativeModuleProbe: () => ({ ok: true, version: '11.10.0' }),
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
      // Keep the bash assertion independent of the host's native binding state.
      nativeModuleProbe: () => ({ ok: true, version: '11.10.0' }),
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

  it('explains Node 24 better-sqlite3 native binding failures with actionable Windows fixes', () => {
    const report = inspectEnvironment({
      env: {
        PATH: 'C:\\tools',
        'ProgramFiles(x86)': 'C:\\missing-visual-studio-root',
      },
      nodeVersion: 'v24.14.0',
      execPath: 'C:\\node\\node.exe',
      platform: 'win32',
      arch: 'x64',
      release: '10.0.19045',
      commandResolver(command) {
        const known = new Set(['git', 'npm', 'npx'])
        return known.has(command) ? `C:\\tools\\${command}.cmd` : null
      },
      commandRunner(command) {
        return {
          exitCode: 0,
          stdout: `${command} 1.0.0`,
          stderr: '',
        }
      },
      nativeModuleProbe(moduleName) {
        expect(moduleName).toBe('better-sqlite3')
        return {
          ok: false,
          error: 'No prebuilt binaries found and no Visual Studio C++ build tools are installed.',
        }
      },
    })

    const sqlite = report.checks.find(check => check.id === 'better-sqlite3-native')
    const buildTools = report.checks.find(check => check.id === 'windows-cpp-build-tools')
    expect(sqlite).toMatchObject({
      status: 'fail',
      required: true,
    })
    expect(sqlite?.reason).toContain('Node.js v24.14.0')
    expect(sqlite?.reason).toContain('prebuilt binary or local C++ rebuild')
    expect(sqlite?.installHint).toContain('Node 22 LTS')
    expect(buildTools).toMatchObject({
      status: 'missing',
      required: false,
    })
    expect(report.status).toBe('broken')
    expect(report.recommendations).toEqual(expect.arrayContaining([
      expect.stringContaining('npm rebuild better-sqlite3'),
    ]))
  })
})

describe('probeNativeModule', () => {
  function fakeSqliteModule(state: { opened: number; closed: number }, failOnOpen?: string) {
    return class FakeDatabase {
      constructor(_path: string) {
        if (failOnOpen) throw new Error(failOnOpen)
        state.opened += 1
      }

      close() {
        state.closed += 1
      }
    }
  }

  it('opens a real handle instead of trusting a successful require()', () => {
    const state = { opened: 0, closed: 0 }
    const abiError = "The module '\\\\?\\E:\\app\\node_modules\\better-sqlite3\\build\\Release\\better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 137. This version of Node.js requires NODE_MODULE_VERSION 127."

    const result = probeNativeModule('better-sqlite3', {
      loadModule: () => fakeSqliteModule(state, abiError),
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('NODE_MODULE_VERSION 137')
    expect(state.opened).toBe(0)
  })

  it('reports ok and closes the handle when the binding loads', () => {
    const state = { opened: 0, closed: 0 }

    const result = probeNativeModule('better-sqlite3', {
      loadModule: () => fakeSqliteModule(state),
      loadPackageVersion: () => '11.10.0',
    })

    expect(result).toEqual({ ok: true, version: '11.10.0' })
    expect(state.opened).toBe(1)
    expect(state.closed).toBe(1)
  })

  it('accepts an ESM default-wrapped constructor', () => {
    const state = { opened: 0, closed: 0 }

    const result = probeNativeModule('better-sqlite3', {
      loadModule: () => ({ default: fakeSqliteModule(state) }),
    })

    expect(result.ok).toBe(true)
    expect(state.opened).toBe(1)
  })

  it('surfaces a missing module as a failed probe', () => {
    const result = probeNativeModule('better-sqlite3', {
      loadModule: () => {
        throw new Error('Cannot find module better-sqlite3')
      },
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Cannot find module')
  })

  it('leaves plain JS modules alone', () => {
    const result = probeNativeModule('js-yaml', {
      loadModule: () => ({ load: () => undefined }),
      loadPackageVersion: () => '4.2.0',
    })

    expect(result).toEqual({ ok: true, version: '4.2.0' })
  })
})
