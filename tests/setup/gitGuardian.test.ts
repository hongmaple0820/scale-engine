import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  addSubrepo,
  DEFAULT_GITIGNORE_ENTRIES,
  detectGitStatus,
  ensureGitIgnore,
  ensureGitInitialized,
  finalizeGitInitialization,
  inspectGitGuardian,
  inspectSubrepos,
  readSubrepoConfig,
  resolveSubrepoConfigPath,
  writeSubrepoConfig,
} from '../../src/setup/GitGuardian.js'

const GIT_TEST_TIMEOUT = 120_000
let root: string
let sequence = 0
let home: string
let emptyHome: string
const savedEnvironment = new Map<string, string | undefined>()

function cleanGitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key]
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
}

function rawGit(cwd: string, args: string[]): string {
  return execFileSync('git', ['--literal-pathspecs', '-C', cwd, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: cleanGitEnvironment(), timeout: 30_000,
  })
}

function assertFixturePath(dir: string): void {
  const path = relative(root, resolve(dir))
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`拒绝对共享测试根以外的目录执行写入命令：${dir}`)
  }
}

function assertOwnRepository(dir: string): void {
  assertFixturePath(dir)
  expect(existsSync(join(dir, '.git')), '初始化失败，不得继续修改任何仓库').toBe(true)
  expect(realpathSync.native(rawGit(dir, ['rev-parse', '--show-toplevel']).trim())).toBe(realpathSync.native(dir))
}

function git(dir: string, args: string[]): string {
  // 所有非初始化命令均先证明归属，防止 fixture 失败后落到宿主仓库。
  assertOwnRepository(dir)
  return rawGit(dir, args)
}

function makeDir(): string {
  const dir = join(root, `case-${++sequence}`)
  mkdirSync(dir)
  return realpathSync.native(dir)
}

function initEmptyRepo(dir: string): void {
  assertFixturePath(dir)
  rawGit(dir, ['init', '-b', 'main'])
  assertOwnRepository(dir)
}

function initRepo(dir: string): void {
  initEmptyRepo(dir)
  git(dir, ['config', 'user.email', 'scale@example.test'])
  git(dir, ['config', 'user.name', 'SCALE Test'])
  writeFileSync(join(dir, 'README.md'), '# test\n')
  git(dir, ['add', '--', 'README.md'])
  git(dir, ['commit', '-m', 'init'])
}

function withEnvironment<T>(values: Record<string, string | undefined>, action: () => T): T {
  const original = new Map(Object.keys(values).map(key => [key, process.env[key]]))
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    return action()
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function makeSymlink(target: string, path: string, context: TestContext, directory = false): void {
  try {
    symlinkSync(target, path, directory && process.platform === 'win32' ? 'junction' : directory ? 'dir' : 'file')
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      context.skip()
      return
    }
    throw error
  }
}

function realSubmodule(path = 'packages/child with spaces'): { parent: string; child: string; source: string } {
  const parent = makeDir()
  const source = makeDir()
  initRepo(parent)
  initRepo(source)
  git(parent, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--', source, path])
  const child = join(parent, path)
  assertOwnRepository(child)
  return { parent, child, source }
}

beforeAll(() => {
  // 仅一个系统临时根；真实检测不在任何仓库内，不模拟 Git、环境清理或文件系统。
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'scale-r4-')))
  try {
    const parent = rawGit(root, ['rev-parse', '--show-toplevel']).trim()
    throw new Error(`测试临时目录意外处于仓库 ${parent} 内，停止测试。`)
  } catch (error) {
    if (!/not a git repository/i.test(String(error))) throw error
  }
  expect(detectGitStatus(root).status).toBe('none')
  home = join(root, 'home')
  emptyHome = join(root, 'empty-home')
  const template = join(root, 'empty-template')
  mkdirSync(home)
  mkdirSync(emptyHome)
  mkdirSync(template)
  const common = `[init]\n\ttemplateDir = "${template.replace(/\\/g, '/')}"\n[commit]\n\tgpgsign = false\n`
  writeFileSync(join(home, '.gitconfig'), `${common}[user]\n\tname = SCALE Test\n\temail = scale@example.test\n`)
  writeFileSync(join(emptyHome, '.gitconfig'), `${common}[user]\n\tuseConfigOnly = true\n\tname =\n\temail =\n`)
  for (const key of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME']) {
    savedEnvironment.set(key, process.env[key])
    process.env[key] = home
  }
}, GIT_TEST_TIMEOUT)

afterAll(() => {
  for (const [key, value] of savedEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (root) {
    try {
      // 不提高安全删除阈值；若保护器阻止，明确报告 blocked 并让测试失败。
      rmSync(root, { recursive: true, force: true })
    } catch (error) {
      throw new Error(`blocked：共享 Git fixture 清理失败，请手工检查 ${root}：${String(error)}`)
    }
  }
}, GIT_TEST_TIMEOUT)

describe('GitGuardian > 仓库真实检测', () => {
  it('独立目录报告 none', () => {
    expect(detectGitStatus(makeDir())).toMatchObject({ status: 'none', ownsRepository: false })
  })

  it('自身仓库报告 repo 和分支状态', () => {
    const dir = makeDir()
    initRepo(dir)
    expect(detectGitStatus(dir)).toMatchObject({
      status: 'repo', ownsRepository: true, toplevel: dir, branch: 'main', clean: true, linkedWorktree: false,
    })
  }, GIT_TEST_TIMEOUT)

  it('父仓库子目录报告 nested', () => {
    const dir = makeDir()
    initRepo(dir)
    const child = join(dir, 'apps', 'web')
    mkdirSync(child, { recursive: true })
    expect(detectGitStatus(child)).toMatchObject({ status: 'nested', ownsRepository: false, toplevel: dir })
  }, GIT_TEST_TIMEOUT)

  it('真实子模块报告 submodule，含空格路径不丢失', () => {
    const { child } = realSubmodule()
    expect(detectGitStatus(child)).toMatchObject({ status: 'submodule', ownsRepository: true, toplevel: child })
  }, GIT_TEST_TIMEOUT)

  it('单独 gitdir 即便名称含 modules 也不是子模块或 worktree', () => {
    const dir = makeDir()
    const metadataRoot = makeDir()
    const metadata = join(metadataRoot, 'modules', 'standalone')
    mkdirSync(join(metadataRoot, 'modules'))
    rawGit(dir, ['init', '-b', 'main', '--separate-git-dir', metadata])
    assertOwnRepository(dir)
    expect(detectGitStatus(dir)).toMatchObject({ status: 'repo', ownsRepository: true, linkedWorktree: false })
  }, GIT_TEST_TIMEOUT)

  it('真实 linked worktree 报告 repo 且 linkedWorktree 为 true', () => {
    const parent = makeDir()
    const container = makeDir()
    const child = join(container, 'linked')
    initRepo(parent)
    git(parent, ['worktree', 'add', '-b', 'linked', '--', child])
    assertOwnRepository(child)
    expect(detectGitStatus(child)).toMatchObject({ status: 'repo', linkedWorktree: true, branch: 'linked' })
    const bytes = readFileSync(join(child, '.git'))
    expect(ensureGitInitialized(child).reused).toBe(true)
    expect(readFileSync(join(child, '.git'))).toEqual(bytes)
    expect(existsSync(join(child, '.gitignore'))).toBe(false)
  }, GIT_TEST_TIMEOUT)

  it('父仓库存在时损坏的自身 .git 不能被误认成父仓库', () => {
    const dir = makeDir()
    initRepo(dir)
    const child = join(dir, 'child')
    mkdirSync(join(child, '.git'), { recursive: true })
    writeFileSync(join(child, '.git', 'HEAD'), 'broken\n')
    expect(detectGitStatus(child)).toMatchObject({ status: 'broken', ownsRepository: true })
  }, GIT_TEST_TIMEOUT)

  it('损坏父仓库报告 broken 而不是 none', () => {
    const parent = makeDir()
    mkdirSync(join(parent, '.git'))
    const child = join(parent, 'child')
    mkdirSync(child)
    expect(detectGitStatus(child).status).toBe('broken')
  })

  it('缺失目录和普通文件均报告 broken', () => {
    const dir = makeDir()
    expect(detectGitStatus(join(dir, 'missing')).status).toBe('broken')
    const file = join(dir, 'file')
    writeFileSync(file, 'x')
    expect(detectGitStatus(file).status).toBe('broken')
  })

  it('Git 可执行文件缺失报告 broken，不尝试初始化', () => {
    const dir = makeDir()
    withEnvironment({ PATH: join(root, 'missing-executables') }, () => {
      expect(detectGitStatus(dir).status).toBe('broken')
      expect(ensureGitInitialized(dir).ok).toBe(false)
      expect(existsSync(join(dir, '.git'))).toBe(false)
    })
  })

  it('裸仓库不能初始化或写入忽略文件', () => {
    const dir = makeDir()
    rawGit(dir, ['init', '--bare'])
    expect(rawGit(dir, ['rev-parse', '--is-bare-repository']).trim()).toBe('true')
    expect(detectGitStatus(dir).status).toBe('broken')
    expect(ensureGitInitialized(dir).ok).toBe(false)
    expect(existsSync(join(dir, '.gitignore'))).toBe(false)
  }, GIT_TEST_TIMEOUT)

  it('继承的 GIT_DIR、GIT_WORK_TREE、GIT_INDEX_FILE 不能改变目录归属', () => {
    const owner = makeDir()
    const target = makeDir()
    initRepo(owner)
    const index = readFileSync(join(owner, '.git', 'index'))
    const config = readFileSync(join(owner, '.git', 'config'))
    withEnvironment({
      GIT_DIR: join(owner, '.git'), GIT_WORK_TREE: owner, GIT_INDEX_FILE: join(owner, '.git', 'index'),
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.bare', GIT_CONFIG_VALUE_0: 'true',
      GIT_CONFIG_GLOBAL: join(owner, 'missing-config'), GIT_OBJECT_DIRECTORY: join(owner, '.git', 'objects'),
    }, () => {
      expect(detectGitStatus(target).status).toBe('none')
      const report = ensureGitInitialized(target, { commit: false })
      expect(report.ok).toBe(true)
      assertOwnRepository(target)
    })
    expect(readFileSync(join(owner, '.git', 'index'))).toEqual(index)
    expect(readFileSync(join(owner, '.git', 'config'))).toEqual(config)
  }, GIT_TEST_TIMEOUT)

  it('含空格的 rename 状态按 NUL 解析', () => {
    const dir = makeDir()
    initRepo(dir)
    git(dir, ['mv', '--', 'README.md', 'renamed file.md'])
    expect(detectGitStatus(dir).changedFiles).toEqual(['renamed file.md', 'README.md'])
  }, GIT_TEST_TIMEOUT)
})

describe('GitGuardian > 忽略规则', () => {
  it('默认忽略秘密及运行时文件，不忽略版本化产物，允许示例环境文件', () => {
    const dir = makeDir()
    initEmptyRepo(dir)
    ensureGitIgnore(dir)
    expect(DEFAULT_GITIGNORE_ENTRIES).not.toContain('.scale/artifacts/')
    for (const file of ['.env', '.env.local', '.env.production', '.env.example', '.env.sample']) writeFileSync(join(dir, file), '')
    const status = git(dir, ['status', '--porcelain=v1', '-z'])
    expect(status).toContain('.env.example\0')
    expect(status).toContain('.env.sample\0')
    expect(status).not.toContain('.env.local\0')
    expect(status).not.toContain('.env.production\0')
    expect(status).not.toContain('?? .env\0')
  }, GIT_TEST_TIMEOUT)

  it('新增规则插在开头，精确保留 CRLF、末尾空白和否定规则优先级', () => {
    const dir = makeDir()
    initEmptyRepo(dir)
    const original = Buffer.from('# 原内容\r\n!.env.local\r\ncustom.txt\r\n \t')
    writeFileSync(join(dir, '.gitignore'), original)
    const first = ensureGitIgnore(dir, ['.env.*', 'custom.txt'])
    expect(first.added).toEqual(['.env.*'])
    expect(first.present).toEqual(['custom.txt'])
    expect(readFileSync(first.path)).toEqual(Buffer.concat([Buffer.from('.env.*\r\n'), original]))
    expect(ensureGitIgnore(dir, ['.env.*', 'custom.txt']).added).toEqual([])
    writeFileSync(join(dir, '.env.local'), '')
    expect(git(dir, ['status', '--porcelain=v1', '-z'])).toContain('.env.local\0')
  }, GIT_TEST_TIMEOUT)

  it('保留 BOM 及既有非 UTF8 字节', () => {
    const dir = makeDir()
    const original = Buffer.from([0xef, 0xbb, 0xbf, 0x23, 0xff, 0x0d, 0x0a])
    writeFileSync(join(dir, '.gitignore'), original)
    ensureGitIgnore(dir, ['dist/'])
    expect(readFileSync(join(dir, '.gitignore'))).toEqual(Buffer.concat([
      original.subarray(0, 3), Buffer.from('dist/\r\n'), original.subarray(3),
    ]))
  })

  it.each(['bad\nrule', 'bad\rrule', 'bad\0rule'])('拒绝控制字符规则 %j 且不修改文件', entry => {
    const dir = makeDir()
    writeFileSync(join(dir, '.gitignore'), 'keep\n')
    expect(() => ensureGitIgnore(dir, [entry])).toThrow()
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('keep\n')
  })

  it('拒绝硬链接忽略文件和子仓库配置，保留链接目标', () => {
    const dir = makeDir()
    const original = join(dir, 'original')
    writeFileSync(original, 'keep\n')
    linkSync(original, join(dir, '.gitignore'))
    expect(() => ensureGitIgnore(dir)).toThrow(/硬链接/)
    mkdirSync(join(dir, '.scale'))
    linkSync(original, join(dir, '.scale', 'subrepos.json'))
    expect(() => readSubrepoConfig(dir)).toThrow(/硬链接/)
    expect(readFileSync(original, 'utf8')).toBe('keep\n')
  })

  it('拒绝 .gitignore 符号链接', context => {
    const dir = makeDir()
    const target = join(dir, 'original')
    writeFileSync(target, 'keep\n')
    makeSymlink(target, join(dir, '.gitignore'), context)
    expect(() => ensureGitIgnore(dir)).toThrow(/符号链接/)
    expect(readFileSync(target, 'utf8')).toBe('keep\n')
  })
})

describe('GitGuardian > 初始化和首次提交', () => {
  it('默认仅提交 .gitignore，不自动暂存 app.txt', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'app.txt'), 'hello\n')
    const report = ensureGitInitialized(dir)
    expect(report, report.warnings.join('\n')).toMatchObject({ ok: true, initialized: true, reused: false, committed: true, branch: 'main' })
    assertOwnRepository(dir)
    expect(report.commit).toMatch(/^[0-9a-f]{40,64}$/)
    expect(git(dir, ['ls-tree', '-r', '--name-only', 'HEAD']).trim()).toBe('.gitignore')
    expect(git(dir, ['status', '--porcelain=v1', '-z'])).toBe('?? app.txt\0')
    expect(readFileSync(join(dir, '.git', 'config'), 'utf8')).not.toMatch(/\[user\]/)
  }, GIT_TEST_TIMEOUT)

  it('分阶段只提交明确 allowlist 的普通文件（包含空格及字面 pathspec 字符）', () => {
    const dir = makeDir()
    const report = ensureGitInitialized(dir, { commit: false })
    assertOwnRepository(dir)
    expect(report.committed).toBe(false)
    expect(git(dir, ['ls-files', '--stage'])).toBe('')
    mkdirSync(join(dir, '.scale'))
    writeFileSync(join(dir, '.scale', 'config.json'), '{}\n')
    writeFileSync(join(dir, 'generated file [a].txt'), 'safe\n')
    writeFileSync(join(dir, 'app.txt'), 'user\n')
    const finalized = finalizeGitInitialization(dir, report, ['.scale/config.json', 'generated file [a].txt'])
    expect(finalized).toBe(report)
    expect(finalized.committed).toBe(true)
    expect(git(dir, ['ls-tree', '-r', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean).sort()).toEqual([
      '.gitignore', '.scale/config.json', 'generated file [a].txt',
    ])
    expect(git(dir, ['status', '--porcelain=v1', '-z'])).toContain('?? app.txt\0')
  }, GIT_TEST_TIMEOUT)

  it('首次提交跳过已忽略的生成文件，不 force-add 运行时状态', () => {
    const dir = makeDir()
    const report = ensureGitInitialized(dir, { commit: false })
    mkdirSync(join(dir, '.scale', 'state'), { recursive: true })
    writeFileSync(join(dir, '.scale', 'state', 'runtime.json'), '{}')
    writeFileSync(join(dir, 'generated.txt'), 'safe\n')
    finalizeGitInitialization(dir, report, ['.scale/state/runtime.json', 'generated.txt'])
    expect(report.committed, report.warnings.join('\n')).toBe(true)
    expect(git(dir, ['ls-tree', '-r', '--name-only', 'HEAD']).trim().split('\n')).toEqual(['.gitignore', 'generated.txt'])
  }, GIT_TEST_TIMEOUT)

  it('身份缺失不伪造配置，ok 保持 true 并提供手工后续步骤', () => {
    const dir = makeDir()
    withEnvironment({ HOME: emptyHome, USERPROFILE: emptyHome, XDG_CONFIG_HOME: emptyHome }, () => {
      const report = ensureGitInitialized(dir)
      assertOwnRepository(dir)
      expect(report).toMatchObject({ ok: true, initialized: true, committed: false })
      expect(report.warnings.length).toBeGreaterThan(0)
      expect(report.nextSteps.join(' ')).toContain('user.name/user.email')
      const config = readFileSync(join(dir, '.git', 'config'), 'utf8')
      expect(config).not.toMatch(/\[user\]|scale@localhost|SCALE Installer/)
      expect(git(dir, ['ls-files']).trim()).toBe('.gitignore')
    })
  }, GIT_TEST_TIMEOUT)

  it('已有仓库复用不修改忽略规则、暂存区、配置和 HEAD', () => {
    const dir = makeDir()
    initRepo(dir)
    writeFileSync(join(dir, '.gitignore'), 'user-rule\n')
    writeFileSync(join(dir, 'staged.txt'), 'user\n')
    git(dir, ['add', '--', 'staged.txt'])
    const before = ['config', 'index', 'HEAD'].map(file => readFileSync(join(dir, '.git', file)))
    const report = ensureGitInitialized(dir)
    expect(report).toMatchObject({ ok: true, initialized: false, reused: true, committed: false })
    expect(report.warnings.join(' ')).toContain('未提交变更')
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('user-rule\n')
    for (const [index, file] of ['config', 'index', 'HEAD'].entries()) expect(readFileSync(join(dir, '.git', file))).toEqual(before[index])
    expect(finalizeGitInitialization(dir, report, ['staged.txt']).committed).toBe(false)
  }, GIT_TEST_TIMEOUT)

  it('已有子模块复用不产生 .gitignore 或新提交', () => {
    const { child } = realSubmodule()
    const head = git(child, ['rev-parse', 'HEAD'])
    expect(ensureGitInitialized(child)).toMatchObject({ ok: true, reused: true, initialized: false, status: 'submodule' })
    expect(git(child, ['rev-parse', 'HEAD'])).toBe(head)
    expect(existsSync(join(child, '.gitignore'))).toBe(false)
  }, GIT_TEST_TIMEOUT)

  it('复用父仓库与显式 nested init 默认都不修改父忽略文件', () => {
    const parent = makeDir()
    initRepo(parent)
    writeFileSync(join(parent, '.gitignore'), 'keep\n')
    const child = join(parent, 'apps', 'web')
    mkdirSync(child, { recursive: true })
    const reused = ensureGitInitialized(child)
    expect(reused).toMatchObject({ ok: true, status: 'nested', reused: true })
    expect(existsSync(join(child, '.git'))).toBe(false)
    expect(existsSync(join(child, '.gitignore'))).toBe(false)
    const initialized = ensureGitInitialized(child, { nestedStrategy: 'init', commit: false })
    expect(initialized.initialized).toBe(true)
    assertOwnRepository(child)
    expect(initialized.parentIgnore).toBeUndefined()
    expect(readFileSync(join(parent, '.gitignore'), 'utf8')).toBe('keep\n')
  }, GIT_TEST_TIMEOUT)

  it('单独授权才写入父忽略文件，glob 路径拒绝修改', () => {
    const parent = makeDir()
    initRepo(parent)
    const child = join(parent, 'child')
    mkdirSync(child)
    expect(ensureGitInitialized(child, { nestedStrategy: 'init', ignoreInParent: true, commit: false }).parentIgnore).toBe(join(parent, '.gitignore'))
    assertOwnRepository(child)
    const before = readFileSync(join(parent, '.gitignore'))
    const globChild = join(parent, 'child[abc]')
    mkdirSync(globChild)
    const report = ensureGitInitialized(globChild, { nestedStrategy: 'init', ignoreInParent: true, commit: false })
    assertOwnRepository(globChild)
    expect(report.warnings.join(' ')).toContain('glob')
    expect(readFileSync(join(parent, '.gitignore'))).toEqual(before)
  }, GIT_TEST_TIMEOUT)

  it('无效分支或损坏仓库返回失败，不回退或改动已有文件', () => {
    const dir = makeDir()
    expect(ensureGitInitialized(dir, { defaultBranch: '--invalid' }).ok).toBe(false)
    expect(existsSync(join(dir, '.git'))).toBe(false)
    mkdirSync(join(dir, '.git'))
    writeFileSync(join(dir, '.git', 'HEAD'), 'broken\n')
    expect(ensureGitInitialized(dir)).toMatchObject({ ok: false, status: 'broken', initialized: false })
    expect(readFileSync(join(dir, '.git', 'HEAD'), 'utf8')).toBe('broken\n')
    expect(existsSync(join(dir, '.gitignore'))).toBe(false)
  }, GIT_TEST_TIMEOUT)

  it('延迟提交发现既有暂存条目时保持 index 原样', () => {
    const dir = makeDir()
    const report = ensureGitInitialized(dir, { commit: false })
    assertOwnRepository(dir)
    writeFileSync(join(dir, 'third-party.txt'), 'keep\n')
    git(dir, ['add', '--', 'third-party.txt'])
    const index = readFileSync(join(dir, '.git', 'index'))
    expect(finalizeGitInitialization(dir, report, []).committed).toBe(false)
    expect(report.warnings.join(' ')).toContain('暂存区已有条目')
    expect(readFileSync(join(dir, '.git', 'index'))).toEqual(index)
    expect(git(dir, ['ls-files']).trim()).toBe('third-party.txt')
  }, GIT_TEST_TIMEOUT)

  it.each(['../outside.txt', '/absolute.txt', '--option', 'file:stream', '.git/config', '.env.production', 'missing.txt'])('首次提交拒绝不安全文件 %j', file => {
    const dir = makeDir()
    const report = ensureGitInitialized(dir, { commit: false })
    assertOwnRepository(dir)
    writeFileSync(join(dir, '.env.production'), 'SECRET=test\n')
    expect(finalizeGitInitialization(dir, report, [file]).committed).toBe(false)
    expect(git(dir, ['ls-files'])).toBe('')
  }, GIT_TEST_TIMEOUT)

  it('首次提交拒绝目录和符号链接', context => {
    const dir = makeDir()
    const report = ensureGitInitialized(dir, { commit: false })
    assertOwnRepository(dir)
    writeFileSync(join(dir, 'source.txt'), 'safe\n')
    makeSymlink(join(dir, 'source.txt'), join(dir, 'link.txt'), context)
    expect(finalizeGitInitialization(dir, report, ['link.txt']).committed).toBe(false)
    expect(git(dir, ['ls-files'])).toBe('')
    const another = makeDir()
    const anotherReport = ensureGitInitialized(another, { commit: false })
    assertOwnRepository(another)
    mkdirSync(join(another, 'directory'))
    expect(finalizeGitInitialization(another, anotherReport, ['directory']).committed).toBe(false)
  }, GIT_TEST_TIMEOUT)

  it('复制或跨项目报告不能授权提交', () => {
    const first = makeDir()
    const report = ensureGitInitialized(first, { commit: false })
    assertOwnRepository(first)
    const copy = { ...report, warnings: [], nextSteps: [] }
    expect(finalizeGitInitialization(first, copy, []).committed).toBe(false)
    const second = makeDir()
    initEmptyRepo(second)
    expect(finalizeGitInitialization(second, report, []).committed).toBe(false)
    expect(git(first, ['ls-files'])).toBe('')
  }, GIT_TEST_TIMEOUT)

  it('不跳过失败 hook，保持暂存区并提供后续步骤', () => {
    const dir = makeDir()
    const report = ensureGitInitialized(dir, { commit: false })
    assertOwnRepository(dir)
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true })
    writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    expect(finalizeGitInitialization(dir, report, []).committed).toBe(false)
    expect(report.ok).toBe(true)
    expect(report.nextSteps.length).toBeGreaterThan(0)
    expect(git(dir, ['ls-files']).trim()).toBe('.gitignore')
  }, GIT_TEST_TIMEOUT)

  it('提交后检测 hook 混入的文件且不自动回滚 HEAD', () => {
    const dir = makeDir()
    const report = ensureGitInitialized(dir, { commit: false })
    assertOwnRepository(dir)
    writeFileSync(join(dir, 'intruder.txt'), 'third party\n')
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true })
    writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\ngit add -- intruder.txt\n', { mode: 0o755 })
    const finalized = finalizeGitInitialization(dir, report, [])
    const tree = git(dir, ['ls-tree', '-r', '--name-only', 'HEAD'])
    if (tree.includes('intruder.txt')) {
      expect(finalized.committed).toBe(false)
      expect(finalized.warnings.join(' ')).toContain('允许的普通文件清单')
    } else {
      expect(finalized.committed).toBe(true)
      expect(tree.trim()).toBe('.gitignore')
    }
    expect(git(dir, ['rev-parse', 'HEAD']).trim()).toMatch(/^[0-9a-f]+$/)
  }, GIT_TEST_TIMEOUT)
})

describe('GitGuardian > 子仓库安全配置及状态', () => {
  const remote = 'https://example.test/child.git'

  it.each(['https://example.test/child.git', 'ssh://git@example.test/child.git', 'git@example.test:org/child.git'])('no-clone 允许 %s 且相同配置幂等', address => {
    const dir = makeDir()
    initEmptyRepo(dir)
    const entry = { path: 'packages/child with spaces', remote: address }
    const first = addSubrepo(dir, entry, { runSubmoduleAdd: false })
    expect(first.ok).toBe(true)
    expect(existsSync(join(dir, entry.path))).toBe(false)
    expect(existsSync(join(dir, '.gitmodules'))).toBe(false)
    const bytes = readFileSync(first.configPath)
    expect(addSubrepo(dir, entry, { runSubmoduleAdd: false }).ok).toBe(true)
    expect(readFileSync(first.configPath)).toEqual(bytes)
    expect(readSubrepoConfig(dir).repos).toEqual([{ ...entry, strategy: 'submodule' }])
    expect(inspectSubrepos(dir).repos[0]).toMatchObject({ ...entry, state: 'unknown', registered: true })
  }, GIT_TEST_TIMEOUT)

  it.each(['', '../escape', '/absolute', 'C:/absolute', '-option', 'a/../b', '.git/modules/a', '.scale/secret', 'a/.git/b', 'a\\b', 'a:b', 'a\nname', 'a/NUL.txt', 'a/trailing.', 'a//b'])('拒绝不安全子仓路径 %j', path => {
    const dir = makeDir()
    initEmptyRepo(dir)
    expect(addSubrepo(dir, { path, remote }, { runSubmoduleAdd: false }).ok).toBe(false)
    expect(existsSync(join(dir, '.scale'))).toBe(false)
  }, GIT_TEST_TIMEOUT)

  it.each(['', '--upload-pack=x', 'file:///repo', '/local/repo', 'ext::helper', 'https://example.test/a\nnext', 'http://example.test/repo', 'git://example.test/repo', 'ssh://-host/repo'])('拒绝不安全远端 %j', address => {
    const dir = makeDir()
    initEmptyRepo(dir)
    expect(addSubrepo(dir, { path: 'child', remote: address }, { runSubmoduleAdd: false }).ok).toBe(false)
    expect(existsSync(join(dir, '.scale'))).toBe(false)
  }, GIT_TEST_TIMEOUT)

  it('要求自身仓库，不能在父仓库子目录登记', () => {
    const parent = makeDir()
    initRepo(parent)
    const child = join(parent, 'child')
    mkdirSync(child)
    expect(addSubrepo(child, { path: 'nested', remote }, { runSubmoduleAdd: false }).ok).toBe(false)
    expect(existsSync(join(child, '.scale'))).toBe(false)
  }, GIT_TEST_TIMEOUT)

  it.each(['{invalid', '{"mode":"mixed","repos":[]}', '{"mode":"submodule","repos":[{"path":"child","remote":"https://example.test/repo"}]}', '{"mode":"none","repos":[],"extra":true}'])('配置损坏或 schema 非法时先拒绝，绝不覆盖 %s', content => {
    const dir = makeDir()
    initEmptyRepo(dir)
    mkdirSync(join(dir, '.scale'))
    const path = join(dir, '.scale', 'subrepos.json')
    writeFileSync(path, content)
    expect(() => readSubrepoConfig(dir)).toThrow()
    expect(addSubrepo(dir, { path: 'child', remote }).ok).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(content)
    expect(existsSync(join(dir, 'child'))).toBe(false)
    expect(() => writeSubrepoConfig(dir, { mode: 'none', repos: [] })).toThrow()
    expect(inspectSubrepos(dir).warnings.length).toBeGreaterThan(0)
  }, GIT_TEST_TIMEOUT)

  it('拒绝配置目录越界，允许项目内绝对路径', () => {
    const dir = makeDir()
    expect(() => resolveSubrepoConfigPath(dir, '../outside')).toThrow()
    expect(() => resolveSubrepoConfigPath(dir, root)).toThrow()
    expect(() => resolveSubrepoConfigPath(dir, '.git')).toThrow()
    expect(resolveSubrepoConfigPath(dir, join(dir, 'config'))).toBe(join(dir, 'config', 'subrepos.json'))
  })

  it('拒绝 .scale、.gitmodules、目标祖先中的 symlink', context => {
    const outside = makeDir()
    const dir = makeDir()
    initEmptyRepo(dir)
    makeSymlink(outside, join(dir, '.scale'), context, true)
    expect(addSubrepo(dir, { path: 'child', remote }, { runSubmoduleAdd: false }).ok).toBe(false)
    expect(() => resolveSubrepoConfigPath(dir)).toThrow(/符号链接/)
    expect(existsSync(join(outside, 'subrepos.json'))).toBe(false)
    const second = makeDir()
    initEmptyRepo(second)
    const file = join(outside, 'gitmodules')
    writeFileSync(file, 'keep\n')
    makeSymlink(file, join(second, '.gitmodules'), context)
    expect(addSubrepo(second, { path: 'child', remote }, { runSubmoduleAdd: false }).ok).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('keep\n')
    const third = makeDir()
    initEmptyRepo(third)
    makeSymlink(outside, join(third, 'packages'), context, true)
    expect(addSubrepo(third, { path: 'packages/child', remote }, { runSubmoduleAdd: false }).ok).toBe(false)
  }, GIT_TEST_TIMEOUT)

  it('不同远端或策略冲突、重叠路径和现有目标均不覆盖', () => {
    const dir = makeDir()
    initEmptyRepo(dir)
    const first = addSubrepo(dir, { path: 'child', remote }, { runSubmoduleAdd: false })
    expect(first.ok).toBe(true)
    const bytes = readFileSync(first.configPath)
    expect(addSubrepo(dir, { path: 'child', remote: 'https://example.test/other.git' }, { runSubmoduleAdd: false }).ok).toBe(false)
    expect(addSubrepo(dir, { path: 'child', remote, strategy: 'standalone' }).ok).toBe(false)
    expect(addSubrepo(dir, { path: 'child/nested', remote }, { runSubmoduleAdd: false }).ok).toBe(false)
    mkdirSync(join(dir, 'existing'))
    expect(addSubrepo(dir, { path: 'existing', remote }, { runSubmoduleAdd: false }).ok).toBe(false)
    expect(readFileSync(first.configPath)).toEqual(bytes)
  }, GIT_TEST_TIMEOUT)

  it('standalone 仅登记，报告各自分支和工作树，拒绝混合 mode', () => {
    const parent = makeDir()
    initEmptyRepo(parent)
    expect(addSubrepo(parent, { path: 'child', remote, strategy: 'standalone' }).ok).toBe(true)
    expect(readSubrepoConfig(parent).mode).toBe('standalone')
    expect(inspectSubrepos(parent).repos[0]?.state).toBe('not-initialised')
    const child = join(parent, 'child')
    mkdirSync(child)
    initRepo(child)
    writeFileSync(join(child, 'dirty file.txt'), 'dirty\n')
    expect(inspectSubrepos(parent).repos[0]).toMatchObject({
      path: 'child', state: 'initialised', branch: 'main', clean: false, changedFiles: ['dirty file.txt'],
    })
    expect(addSubrepo(parent, { path: 'other', remote }, { runSubmoduleAdd: false }).ok).toBe(false)
  }, GIT_TEST_TIMEOUT)

  it('真实子模块状态比较 gitlink，并报告 clean、dirty、out-of-sync 和 conflict', () => {
    const path = 'packages/child with spaces'
    const { parent, child } = realSubmodule(path)
    writeSubrepoConfig(parent, { mode: 'submodule', repos: [{ path, remote, strategy: 'submodule' }] })
    expect(inspectSubrepos(parent).repos[0]).toMatchObject({ path, state: 'initialised', clean: true, branch: 'main' })
    const originalCommit = git(child, ['rev-parse', 'HEAD']).trim()
    writeFileSync(join(child, 'dirty file.txt'), 'dirty\n')
    expect(inspectSubrepos(parent).repos[0]).toMatchObject({ state: 'initialised', clean: false, changedFiles: ['dirty file.txt'] })
    git(child, ['add', '--', 'dirty file.txt'])
    git(child, ['commit', '-m', 'change'])
    expect(inspectSubrepos(parent).repos[0]).toMatchObject({ state: 'out-of-sync', clean: true })
    const updatedCommit = git(child, ['rev-parse', 'HEAD']).trim()
    // 用 NUL 格式写入仅位于 fixture 的冲突暂存条目，不接触任何宿主 refs。
    assertOwnRepository(parent)
    execFileSync('git', ['-C', parent, 'update-index', '-z', '--index-info'], {
      input: `0 ${'0'.repeat(originalCommit.length)}\t${path}\0` +
        `160000 ${originalCommit} 1\t${path}\0` + `160000 ${originalCommit} 2\t${path}\0` + `160000 ${updatedCommit} 3\t${path}\0`,
      env: cleanGitEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000,
    })
    expect(inspectSubrepos(parent).repos[0]).toMatchObject({ path, state: 'conflict', clean: true })
  }, GIT_TEST_TIMEOUT)

  it('登记的 gitlink 尚未初始化时报告 not-initialised', () => {
    const dir = makeDir()
    const source = makeDir()
    initRepo(dir)
    initRepo(source)
    const oid = git(source, ['rev-parse', 'HEAD']).trim()
    git(dir, ['update-index', '--add', '--cacheinfo', `160000,${oid},child with spaces`])
    writeSubrepoConfig(dir, { mode: 'submodule', repos: [{ path: 'child with spaces', remote, strategy: 'submodule' }] })
    expect(inspectSubrepos(dir).repos[0]).toMatchObject({ path: 'child with spaces', state: 'not-initialised', commit: oid })
  }, GIT_TEST_TIMEOUT)

  it('nested 下的汇总只返回项目登记，不探测父仓库子模块', () => {
    const { parent } = realSubmodule()
    const child = join(parent, 'nested')
    mkdirSync(child)
    writeSubrepoConfig(child, { mode: 'submodule', repos: [{ path: 'own child', remote, strategy: 'submodule' }] })
    const report = inspectGitGuardian(child)
    expect(report.repository.status).toBe('nested')
    expect(report.subrepos.repos).toHaveLength(1)
    expect(report.subrepos.repos[0]).toMatchObject({ path: 'own child', state: 'unknown' })
  }, GIT_TEST_TIMEOUT)
})
