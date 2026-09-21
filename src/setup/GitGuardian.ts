import { execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve, sep, win32 } from 'node:path'

export type GitRepositoryStatus = 'none' | 'repo' | 'nested' | 'submodule' | 'broken'

export interface GitStatusReport {
  status: GitRepositoryStatus
  projectDir: string
  toplevel?: string
  ownsRepository: boolean
  linkedWorktree?: boolean
  branch?: string
  clean?: boolean
  changedFiles?: string[]
  message: string
}

export const DEFAULT_GITIGNORE_ENTRIES = [
  'node_modules/',
  'dist/',
  '.env',
  '.env.*',
  '!.env.example',
  '!.env.sample',
  '.scale/tmp/',
  '.scale/secrets/',
  '.scale/state/',
  '.planning/cache/',
] as const

export const DEFAULT_INITIAL_COMMIT_MESSAGE = 'chore: init scale-engine workspace'

export function detectGitStatus(projectDir: string): GitStatusReport {
  const dir = canonical(projectDir)
  let ownsRepository = false
  try {
    requireDirectory(projectDir)
    const gitEntry = entryStat(join(dir, '.git'))
    ownsRepository = Boolean(gitEntry)
    if (gitEntry?.isSymbolicLink()) throw new Error('.git 是符号链接，拒绝使用。')
    runGit(dir, ['--version'])
    let bare: string
    try {
      bare = runGit(dir, ['rev-parse', '--is-bare-repository']).trim()
    } catch (error) {
      // 无仓库与损坏仓库必须区分，尤其不能回退到父仓库后认作自身仓库。
      if (ownsRepository || hasRepositoryMarker(dir) || !/not a git repository/i.test(errorMessage(error))) throw error
      return {
        status: 'none', projectDir: dir, ownsRepository: false,
        message: '当前目录及父目录未发现 Git 仓库。',
      }
    }
    if (bare === 'true') throw new Error('这是裸仓库，不能作为项目工作区初始化或写入。')
    const toplevel = canonical(runGit(dir, ['rev-parse', '--show-toplevel']).trim())
    if (ownsRepository !== samePath(toplevel, dir)) {
      throw new Error('Git 工作区根目录与当前目录的 .git 所有权不一致。')
    }
    const detail = readRepositoryDetail(dir)
    if (!ownsRepository) {
      return {
        status: 'nested', projectDir: dir, ownsRepository, toplevel, ...detail,
        message: `当前目录位于父仓库 ${toplevel} 内，没有自己的仓库。`,
      }
    }
    const superproject = runGit(dir, ['rev-parse', '--show-superproject-working-tree']).trim()
    const gitDir = canonical(runGit(dir, ['rev-parse', '--absolute-git-dir']).trim())
    const commonDir = canonical(resolve(dir, runGit(dir, ['rev-parse', '--git-common-dir']).trim()))
    const linkedWorktree = Boolean(gitEntry?.isFile() && !samePath(gitDir, commonDir))
    return {
      status: superproject ? 'submodule' : 'repo', projectDir: dir, ownsRepository,
      toplevel, linkedWorktree, ...detail,
      message: superproject ? '当前目录是 Git 子模块，仅检查状态。'
        : linkedWorktree ? '当前目录是关联工作树，仅检查状态。' : '当前目录已拥有 Git 仓库。',
    }
  } catch (error) {
    return {
      status: 'broken', projectDir: dir, ownsRepository,
      message: `Git 仓库不可用，保持原状，请手工修复：${errorMessage(error)}`,
    }
  }
}

export interface GitIgnoreResult {
  path: string
  created: boolean
  added: string[]
  present: string[]
}

export function ensureGitIgnore(
  projectDir: string,
  entries: readonly string[] = DEFAULT_GITIGNORE_ENTRIES,
): GitIgnoreResult {
  const dir = requireDirectory(projectDir)
  const path = safePath(dir, '.gitignore')
  const info = entryStat(path)
  if (info && (!info.isFile() || info.nlink !== 1)) throw new Error('.gitignore 必须是无硬链接的普通文件。')
  const created = !info
  const existing = created ? Buffer.alloc(0) : readFileSync(path)
  const hasBom = existing.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
  const body = hasBom ? existing.subarray(3) : existing
  const known = new Set(body.toString('utf8').split(/\r?\n/))
  const added: string[] = []
  const present: string[] = []
  for (const entry of entries) {
    if (typeof entry !== 'string' || /[\r\n\0]/.test(entry)) throw new Error('忽略规则不能包含换行或 NUL。')
    if (!entry) continue
    if (known.has(entry)) present.push(entry)
    else {
      known.add(entry)
      added.push(entry)
    }
  }
  if (created || added.length) {
    const newline = body.includes(Buffer.from('\r\n')) ? '\r\n' : '\n'
    const prefix = Buffer.from(added.length ? `${added.join(newline)}${newline}` : '')
    // 默认规则放在前面，既有否定规则仍拥有最后匹配优先级；原始字节不裁剪。
    const content = Buffer.concat([hasBom ? existing.subarray(0, 3) : Buffer.alloc(0), prefix, body])
    safePath(dir, '.gitignore')
    writeFileSync(path, content, { flag: created ? 'wx' : 'w' })
  }
  return { path, created, added, present }
}

export interface GitInitOptions {
  defaultBranch?: string
  gitignoreEntries?: readonly string[]
  nestedStrategy?: 'init' | 'reuse'
  commitMessage?: string
  /** 默认立即提交 .gitignore；安装器可以延迟到生成文件后再提交。 */
  commit?: boolean
  /** 独立授权修改父仓库忽略规则，默认关闭。 */
  ignoreInParent?: boolean
}

export interface GitInitReport {
  /** 仅表示初始化或复用是否成功，提交失败不会将其改为 false。 */
  ok: boolean
  status: GitRepositoryStatus
  initialized: boolean
  reused: boolean
  branch?: string
  committed: boolean
  commit?: string
  gitignore?: GitIgnoreResult
  parentIgnore?: string
  warnings: string[]
  nextSteps: string[]
  message: string
}

interface InitializationAuthority {
  dir: string
  gitDir: string
  device: number
  inode: number
  branch: string
  message: string
}

// 只允许本进程刚创建的仓库完成首次提交，不接受伪造或复用报告。
const initializationAuthorities = new WeakMap<GitInitReport, InitializationAuthority>()

export function ensureGitInitialized(projectDir: string, options: GitInitOptions = {}): GitInitReport {
  const detected = detectGitStatus(projectDir)
  const dir = detected.projectDir
  const report: GitInitReport = {
    ok: false, status: detected.status, initialized: false, reused: false,
    branch: detected.branch, committed: false, warnings: [], nextSteps: [], message: detected.message,
  }
  if (detected.status === 'broken') {
    report.warnings.push(detected.message)
    report.nextSteps.push('请手工检查项目目录、Git 可执行文件和仓库结构；不要覆盖已有 .git。')
    return report
  }
  if (detected.ownsRepository || (detected.status === 'nested' && options.nestedStrategy !== 'init')) {
    report.ok = true
    report.reused = true
    if (!detected.clean) report.warnings.push(`已有仓库存在 ${detected.changedFiles?.length ?? 0} 项未提交变更，保持原状。`)
    if (detected.status === 'nested') {
      report.warnings.push(`复用父仓库 ${detected.toplevel}，不修改其忽略规则或暂存区。`)
      report.nextSteps.push('需要独立仓库时，显式使用 --git-init-nested。')
    }
    report.message = '已复用现有仓库，未写入 .gitignore、暂存区、配置或提交。'
    return report
  }

  const branch = options.defaultBranch ?? 'main'
  try {
    requireDirectory(projectDir)
    if (typeof branch !== 'string' || !branch || branch.startsWith('-')) throw new Error('初始分支名称不合法。')
    runGit(dir, ['check-ref-format', '--branch', branch])
    if (entryStat(join(dir, '.git'))) throw new Error('初始化前出现了新的 .git，停止操作。')
    // Git 2.28+；失败时不尝试可能误写其他仓库的无条件回退。
    runGit(dir, ['init', '-b', branch])
    const initialized = requireOwnRepository(dir)
    if (initialized.branch !== branch || readHead(dir)) throw new Error('初始化后的分支或 HEAD 不符合预期。')
    const gitDir = canonical(runGit(dir, ['rev-parse', '--absolute-git-dir']).trim())
    const info = lstatSync(gitDir)
    report.ok = true
    report.initialized = true
    report.branch = branch
    report.message = `已在 ${branch} 分支初始化 Git 仓库。`
    initializationAuthorities.set(report, {
      dir, gitDir, device: info.dev, inode: info.ino, branch,
      message: options.commitMessage ?? DEFAULT_INITIAL_COMMIT_MESSAGE,
    })
  } catch (error) {
    report.warnings.push(`Git 初始化失败，保留现场：${errorMessage(error)}`)
    report.nextSteps.push('请手工检查 Git 版本（要求 2.28+）、目录权限以及已有仓库状态。')
    return report
  }

  if (detected.status === 'nested' && detected.toplevel && options.ignoreInParent === true) {
    try {
      const subPath = relative(detected.toplevel, dir).split(sep).join('/')
      validateRelativePath(subPath, true)
      if (/[\[\]]/.test(subPath)) throw new Error('父忽略规则路径不能包含 glob 元字符。')
      report.parentIgnore = ensureGitIgnore(detected.toplevel, [`/${subPath}/`]).path
    } catch (error) {
      report.warnings.push(`未修改父仓库忽略规则：${errorMessage(error)}`)
    }
  }
  try {
    report.gitignore = ensureGitIgnore(dir, options.gitignoreEntries)
  } catch (error) {
    report.warnings.push(`仓库已初始化，但未写入 .gitignore：${errorMessage(error)}`)
    report.nextSteps.push('请手工检查 .gitignore 的类型、权限和忽略规则。')
    initializationAuthorities.delete(report)
    return report
  }
  return options.commit === false ? report : finalizeGitInitialization(dir, report, [])
}

export function finalizeGitInitialization(
  projectDir: string,
  report: GitInitReport,
  files: readonly string[],
): GitInitReport {
  if (!report.ok || !report.initialized || report.reused || report.committed) return report
  const authority = initializationAuthorities.get(report)
  initializationAuthorities.delete(report)
  try {
    const dir = requireDirectory(projectDir)
    if (!authority || !samePath(dir, authority.dir)) throw new Error('该报告不属于本次项目初始化。')
    assertInitializationAuthority(authority)
    if (readIndex(dir).length) throw new Error('暂存区已有条目；拒绝混入用户、钩子或其他进程的变更。')
    const requested = [...new Set(['.gitignore', ...files])]
    for (const file of requested) requireCommitFile(dir, file)
    // An adapter may report generated runtime files that its own ignore excludes.
    // Never force-add these; validate every path before selecting the commit set.
    const allowlist = requested.filter(file => {
      try {
        runGit(dir, ['check-ignore', '--quiet', '--', file])
        return false
      } catch (error) {
        if ((error as { status?: number }).status === 1) return true
        throw error
      }
    })
    if (!allowlist.length) throw new Error('没有可提交的允许文件（均被忽略）。')
    runGit(dir, ['add', '--', ...allowlist])
    const staged = readIndex(dir)
    assertAllowedTree(staged, allowlist)
    assertInitializationAuthority(authority)
    for (const file of allowlist) requireCommitFile(dir, file)
    // --only 同时约束提交使用的路径；仍正常执行用户钩子和签名。
    runGit(dir, ['commit', '--only', '-m', authority.message, '--', ...allowlist])
    requireOwnRepository(dir)
    const head = readHead(dir)
    if (!head) throw new Error('提交命令完成，但无法确认 HEAD。')
    const parents = runGit(dir, ['rev-list', '--parents', '-n', '1', head]).trim().split(/\s+/)
    if (parents.length !== 1) throw new Error('提交期间 HEAD 被其他进程改变，并非首次提交。')
    const tree = readTree(dir, head)
    assertAllowedTree(tree, allowlist)
    if (treeSignature(tree) !== treeSignature(staged)) throw new Error('提交树与已验证暂存快照不同，请检查钩子或并发写入。')
    report.committed = true
    report.commit = head
    report.message = `仓库已初始化，仅提交了 ${allowlist.length} 个允许的文件。`
  } catch (error) {
    report.committed = false
    report.warnings.push(`未确认安全的首次提交，保留所有当前状态：${errorMessage(error)}`)
    report.nextSteps.push('请检查 git status、git diff --cached 和 HEAD；确认 user.name/user.email、钩子及签名配置后手工提交。')
  }
  return report
}

export type SubrepoMode = 'none' | 'submodule' | 'standalone'

export interface SubrepoEntry {
  path: string
  remote: string
  strategy: 'submodule' | 'standalone'
}

export interface SubrepoConfig {
  mode: SubrepoMode
  repos: SubrepoEntry[]
}

export interface SubrepoStatusEntry extends SubrepoEntry {
  registered: boolean
  state: 'initialised' | 'out-of-sync' | 'not-initialised' | 'conflict' | 'unknown'
  commit?: string
  branch?: string
  clean?: boolean
  changedFiles?: string[]
}

export interface SubrepoStatusReport {
  configPath: string
  mode: SubrepoMode
  repos: SubrepoStatusEntry[]
  warnings: string[]
}

export interface SubrepoAddReport {
  ok: boolean
  path: string
  remote: string
  configPath: string
  warnings: string[]
  message: string
}

export function resolveSubrepoConfigPath(projectDir: string, scaleDir?: string): string {
  const dir = requireDirectory(projectDir)
  const requested = scaleDir ?? '.scale'
  const subPath = isAbsolute(requested) ? relative(dir, requested).split(sep).join('/') : requested
  validateRelativePath(subPath, true)
  return safePath(dir, `${subPath}/subrepos.json`)
}

export function readSubrepoConfig(projectDir: string, scaleDir?: string): SubrepoConfig {
  const path = resolveSubrepoConfigPath(projectDir, scaleDir)
  const info = entryStat(path)
  if (!info) return { mode: 'none', repos: [] }
  if (!info.isFile() || info.nlink !== 1) throw new Error('子仓库配置必须是无硬链接的普通 JSON 文件。')
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`子仓库配置 JSON 损坏，拒绝覆盖：${errorMessage(error)}`)
  }
  return validateSubrepoConfig(projectDir, value)
}

export function writeSubrepoConfig(projectDir: string, config: SubrepoConfig, scaleDir?: string): string {
  const path = resolveSubrepoConfigPath(projectDir, scaleDir)
  readSubrepoConfig(projectDir, scaleDir)
  const validated = validateSubrepoConfig(projectDir, config)
  mkdirSync(dirname(path), { recursive: true })
  resolveSubrepoConfigPath(projectDir, scaleDir)
  const repos = [...validated.repos].sort((a, b) => a.path.localeCompare(b.path))
  writeFileSync(path, `${JSON.stringify({ mode: validated.mode, repos }, null, 2)}\n`, 'utf8')
  return path
}

export function addSubrepo(
  projectDir: string,
  entry: { path: string; remote: string; strategy?: SubrepoEntry['strategy'] },
  options: { scaleDir?: string; runSubmoduleAdd?: boolean } = {},
): SubrepoAddReport {
  const result: SubrepoAddReport = {
    ok: false, path: entry.path, remote: entry.remote, configPath: '', warnings: [], message: '',
  }
  try {
    const dir = requireDirectory(projectDir)
    requireOwnRepository(dir)
    safePath(dir, '.scale')
    const gitmodules = safePath(dir, '.gitmodules')
    const modulesInfo = entryStat(gitmodules)
    if (modulesInfo && (!modulesInfo.isFile() || modulesInfo.nlink !== 1)) throw new Error('.gitmodules 必须是无硬链接的普通文件。')
    result.configPath = resolveSubrepoConfigPath(dir, options.scaleDir)
    const current = readSubrepoConfig(dir, options.scaleDir)
    const strategy = entry.strategy ?? 'submodule'
    const candidate: SubrepoEntry = { path: entry.path, remote: entry.remote, strategy }
    validateSubrepoConfig(dir, { mode: strategy, repos: [candidate] })
    const duplicate = current.repos.find(item => pathKey(item.path) === pathKey(entry.path))
    if (duplicate) {
      if (duplicate.remote !== entry.remote || duplicate.strategy !== strategy || duplicate.path !== entry.path) {
        throw new Error('该路径已登记不同的远端或策略，不会覆盖。')
      }
      result.ok = true
      result.message = `子仓库 ${entry.path} 已以相同配置登记，未作任何更改。`
      return result
    }
    if (current.mode !== 'none' && current.mode !== strategy) throw new Error('不支持混合 submodule 与 standalone 模式。')
    const config: SubrepoConfig = { mode: strategy, repos: [...current.repos, candidate] }
    validateSubrepoConfig(dir, config)
    const target = safePath(dir, entry.path)
    if (entryStat(target)) throw new Error('目标路径已存在，不会覆盖或接管。')
    if (strategy === 'submodule' && options.runSubmoduleAdd !== false) {
      // 禁止 URL 重写将允许的远端转成 file/ext 等本地或外部协议。
      runGit(dir, [
        '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always',
        'submodule', 'add', '--', entry.remote, entry.path,
      ])
      requireOwnRepository(dir)
      requireOwnRepository(target)
    }
    result.configPath = writeSubrepoConfig(dir, config, options.scaleDir)
    result.ok = true
    result.message = `已登记 ${strategy} 子仓库 ${entry.path}。`
  } catch (error) {
    result.message = `登记失败：${errorMessage(error)}`
    result.warnings.push('未自动删除、回滚或清理任何文件；如 Git 已开始操作，请手工检查工作区和暂存区。')
  }
  return result
}

export interface SubrepoInspectOptions {
  probeGit?: boolean
}

export function inspectSubrepos(
  projectDir: string,
  scaleDir?: string,
  options: SubrepoInspectOptions = {},
): SubrepoStatusReport {
  const result: SubrepoStatusReport = { configPath: '', mode: 'none', repos: [], warnings: [] }
  try {
    const dir = requireDirectory(projectDir)
    result.configPath = resolveSubrepoConfigPath(dir, scaleDir)
    const config = readSubrepoConfig(dir, scaleDir)
    result.mode = config.mode
    result.repos = config.repos.map(entry => ({ ...entry, registered: true, state: 'unknown' }))
    if (options.probeGit === false || !config.repos.length) return result
    const repository = detectGitStatus(dir)
    if (!repository.ownsRepository || repository.status === 'broken') {
      result.warnings.push('项目没有可用的自身仓库，仅报告登记配置，不探测父仓库子模块。')
      return result
    }
    for (const entry of result.repos) {
      try {
        const target = safePath(dir, entry.path)
        const indexed = entry.strategy === 'submodule'
          ? readIndex(dir, entry.path).filter(item => item.path === entry.path) : []
        const conflicted = indexed.some(item => item.stage !== '0')
        const gitlink = indexed.find(item => item.mode === '160000' && item.stage === '0')
        const child = entryStat(target) ? detectGitStatus(target) : undefined
        if (child?.ownsRepository && child.status !== 'broken') {
          entry.branch = child.branch
          entry.clean = child.clean
          entry.changedFiles = child.changedFiles
          entry.commit = readHead(target)
          entry.state = entry.strategy === 'standalone' ? 'initialised'
            : gitlink ? (entry.commit === gitlink.oid ? 'initialised' : 'out-of-sync') : 'unknown'
        } else if (gitlink || entry.strategy === 'standalone') {
          entry.state = 'not-initialised'
          entry.commit = gitlink?.oid
        }
        if (conflicted) entry.state = 'conflict'
        if (child?.status === 'broken') result.warnings.push(`${entry.path}：${child.message}`)
      } catch (error) {
        result.warnings.push(`${entry.path} 状态不可用：${errorMessage(error)}`)
      }
    }
  } catch (error) {
    result.warnings.push(`子仓库配置不可用，未使用默认配置覆盖：${errorMessage(error)}`)
  }
  return result
}

export interface GitGuardianReport {
  repository: GitStatusReport
  subrepos: SubrepoStatusReport
}

export function inspectGitGuardian(projectDir: string, scaleDir?: string): GitGuardianReport {
  const repository = detectGitStatus(projectDir)
  return {
    repository,
    subrepos: inspectSubrepos(projectDir, scaleDir, {
      probeGit: repository.ownsRepository && repository.status !== 'broken',
    }),
  }
}

function runGit(cwd: string, args: string[], input?: string): string {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^GIT_/i.test(key)) env[key] = value
  }
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_OPTIONAL_LOCKS = '0'
  // check-ignore consumes literal pathnames itself and rejects pathspec magic.
  const literal = args[0] === 'check-ignore' ? [] : ['--literal-pathspecs']
  return execFileSync('git', [...literal, '-C', cwd, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env, timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  })
}

function canonical(path: string): string {
  const resolved = resolve(path)
  try {
    return realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

function samePath(a: string, b: string): boolean {
  return pathKey(resolve(a)) === pathKey(resolve(b))
}

function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function entryStat(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function assertNoSymlinks(path: string): void {
  const absolute = resolve(path)
  let current = parse(absolute).root
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    if (entryStat(current)?.isSymbolicLink()) throw new Error(`拒绝符号链接路径：${current}`)
  }
}

function requireDirectory(path: string): string {
  assertNoSymlinks(path)
  if (!statSync(path).isDirectory()) throw new Error('项目路径不是现有目录。')
  return canonical(path)
}

function validateRelativePath(path: string, allowScale = false): void {
  if (typeof path !== 'string' || !path || isAbsolute(path) || win32.isAbsolute(path) || path.includes('\\')) {
    throw new Error('路径必须是项目内使用正斜杠的相对路径。')
  }
  const parts = path.split('/')
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || part.startsWith('-') || /[\x00-\x1f\x7f<>:"|?*]/.test(part)
      || /[. ]$/.test(part) || /^\.git$/i.test(part) || /^git~\d+$/i.test(part)
      || (!allowScale && /^\.scale$/i.test(part)) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) {
      throw new Error(`不安全的路径组成部分：${part}`)
    }
  }
}

function safePath(dir: string, path: string): string {
  validateRelativePath(path, true)
  assertNoSymlinks(dir)
  const target = resolve(dir, path)
  assertNoSymlinks(target)
  const rel = relative(canonical(dir), canonical(target))
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('路径超出项目目录。')
  return target
}

function hasRepositoryMarker(dir: string): boolean {
  let current = dir
  while (true) {
    if (entryStat(join(current, '.git')) || (entryStat(join(current, 'HEAD')) && entryStat(join(current, 'objects')))) return true
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
}

function requireOwnRepository(dir: string): GitStatusReport {
  const report = detectGitStatus(dir)
  if (!report.ownsRepository || !report.toplevel || !samePath(report.toplevel, dir) || report.status === 'broken') {
    throw new Error(`要求当前目录拥有可用仓库：${report.message}`)
  }
  return report
}

function readRepositoryDetail(dir: string): { branch?: string; clean: boolean; changedFiles: string[] } {
  let branch: string | undefined
  try {
    branch = runGit(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']).trim() || undefined
  } catch (error) {
    if ((error as { status?: number }).status !== 1) throw error
  }
  const records = runGit(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0')
  const changedFiles: string[] = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    if (!record) continue
    if (record.length < 4) throw new Error('无法解析 Git 状态记录。')
    changedFiles.push(record.slice(3))
    if (/[RC]/.test(record.slice(0, 2))) {
      const source = records[++i]
      if (!source) throw new Error('无法解析 Git 重命名记录。')
      changedFiles.push(source)
    }
  }
  return { branch, clean: changedFiles.length === 0, changedFiles: [...new Set(changedFiles)] }
}

function readHead(dir: string): string | undefined {
  try {
    return runGit(dir, ['rev-parse', '--verify', '--quiet', 'HEAD']).trim() || undefined
  } catch (error) {
    if ((error as { status?: number }).status === 1) return undefined
    throw error
  }
}

function assertInitializationAuthority(authority: InitializationAuthority): void {
  const report = requireOwnRepository(authority.dir)
  const actualGitDir = canonical(runGit(authority.dir, ['rev-parse', '--absolute-git-dir']).trim())
  const info = lstatSync(actualGitDir)
  if (!samePath(actualGitDir, authority.gitDir) || info.dev !== authority.device || info.ino !== authority.inode
    || info.isSymbolicLink() || report.branch !== authority.branch || readHead(authority.dir)) {
    throw new Error('仓库所有权、初始分支或 HEAD 已发生变化。')
  }
  assertNoSymlinks(actualGitDir)
  const index = join(actualGitDir, 'index')
  assertNoSymlinks(index)
  const indexInfo = entryStat(index)
  if (indexInfo && (!indexInfo.isFile() || indexInfo.nlink !== 1)) throw new Error('仓库暂存区不是独立普通文件。')
}

function requireCommitFile(dir: string, file: string): void {
  const path = safePath(dir, file)
  const info = lstatSync(path)
  if (!info.isFile() || info.nlink !== 1) throw new Error(`仅允许无链接的普通文件：${file}`)
  const parts = file.split('/')
  if (parts.some(part => /^\.env(?:\.|$)/i.test(part) && !/^\.env\.(example|sample)$/.test(part))) {
    throw new Error(`拒绝提交可能包含秘密的环境文件：${file}`)
  }
}

interface GitTreeEntry { mode: string; oid: string; stage: string; path: string }

function readIndex(dir: string, path?: string): GitTreeEntry[] {
  const output = runGit(dir, ['ls-files', '--stage', '-z', ...(path ? ['--', path] : [])])
  return output.split('\0').filter(Boolean).map(record => {
    const match = /^(\d{6}) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/.exec(record)
    if (!match) throw new Error('无法解析暂存区。')
    return { mode: match[1]!, oid: match[2]!, stage: match[3]!, path: match[4]! }
  })
}

function readTree(dir: string, head: string): GitTreeEntry[] {
  return runGit(dir, ['ls-tree', '-r', '-z', head]).split('\0').filter(Boolean).map(record => {
    const match = /^(\d{6}) blob ([0-9a-f]+)\t([\s\S]+)$/.exec(record)
    if (!match) throw new Error('提交树含非普通文件或无法解析的条目。')
    return { mode: match[1]!, oid: match[2]!, stage: '0', path: match[3]! }
  })
}

function assertAllowedTree(tree: GitTreeEntry[], files: readonly string[]): void {
  if (tree.length !== files.length || new Set(tree.map(entry => entry.path)).size !== files.length
    || tree.some(entry => !files.includes(entry.path) || entry.stage !== '0' || !['100644', '100755'].includes(entry.mode))) {
    throw new Error('暂存区或实际提交树超出了允许的普通文件清单。')
  }
}

function treeSignature(tree: GitTreeEntry[]): string {
  return JSON.stringify(tree.map(entry => [entry.path, entry.mode, entry.oid]).sort((a, b) => a[0]!.localeCompare(b[0]!)))
}

function validateRemote(remote: string): void {
  if (typeof remote !== 'string' || !remote || remote.startsWith('-') || /[\s\x00-\x1f\x7f\\]/.test(remote)) {
    throw new Error('远端地址不合法。')
  }
  if (/^git@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?:[a-z0-9_./~][a-z0-9_./~-]*$/i.test(remote)) return
  if (!/^https:\/\/|^ssh:\/\//.test(remote)) throw new Error('仅允许 https://、ssh:// 或 git@host:path 远端。')
  const url = new URL(remote)
  if (!url.hostname || url.hostname.startsWith('-') || url.password || url.search || url.hash
    || !url.pathname || url.pathname === '/') throw new Error('远端 URL 必须包含主机和仓库路径，不能带密码、查询或片段。')
}

function validateSubrepoConfig(projectDir: string, value: unknown): SubrepoConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('子仓库配置必须是对象。')
  const object = value as Record<string, unknown>
  if (Object.keys(object).some(key => !['mode', 'repos'].includes(key))
    || !['none', 'submodule', 'standalone'].includes(String(object.mode)) || !Array.isArray(object.repos)) {
    throw new Error('子仓库配置 schema 或 mode 不合法。')
  }
  const repos: SubrepoEntry[] = []
  for (const item of object.repos) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(key => !['path', 'remote', 'strategy'].includes(key))) throw new Error('子仓库条目 schema 不合法。')
    const entry = item as SubrepoEntry
    validateRelativePath(entry.path)
    validateRemote(entry.remote)
    safePath(requireDirectory(projectDir), entry.path)
    if (!['submodule', 'standalone'].includes(entry.strategy) || entry.strategy !== object.mode) {
      throw new Error('子仓库策略不合法或存在混合模式。')
    }
    const key = pathKey(entry.path)
    if (repos.some(previous => {
      const previousKey = pathKey(previous.path)
      return key === previousKey || key.startsWith(`${previousKey}/`) || previousKey.startsWith(`${key}/`)
    })) throw new Error('子仓库路径重复或互相嵌套。')
    repos.push({ path: entry.path, remote: entry.remote, strategy: entry.strategy })
  }
  if (object.mode === 'none' && repos.length) throw new Error('none 模式不能登记子仓库。')
  return { mode: object.mode as SubrepoMode, repos }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
