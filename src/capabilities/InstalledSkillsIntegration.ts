// SCALE Engine — Installed Skills Integration v0.10.0
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execa } from 'execa'
import { parseCommandLine } from '../tools/SafeCommandRunner.js'

export const SKILLS_DIR = join(homedir(), '.claude', 'skills')
export const AGENTS_SKILLS_DIR = join(homedir(), '.agents', 'skills')
export const DEFAULT_SKILL_ROOTS = [AGENTS_SKILLS_DIR, SKILLS_DIR]
const PDF_EXTRACT_CODE = "from pypdf import PdfReader; import sys; r=PdfReader(sys.argv[1]); print('\\n'.join([p.extract_text() for p in r.pages]))"
const PDF_MERGE_CODE = 'from pypdf import PdfReader, PdfWriter; import sys; w=PdfWriter(); [w.add_page(page) for f in sys.argv[1:-1] for page in PdfReader(f).pages]; w.write(sys.argv[-1])'
const XLSX_ANALYZE_CODE = 'import pandas as pd; import sys; df=pd.read_excel(sys.argv[1]); print(df.describe())'

export interface SkillInvocationResult {
  success: boolean
  output?: string
  error?: string
  durationMs: number
  skillId: string
}

interface InstalledSkillRunOptions {
  cwd?: string
}

export function resolveInstalledSkillPath(skillId: string, segments: string[] = [], roots: string[] = DEFAULT_SKILL_ROOTS): string {
  const candidates = roots.map(root => join(root, skillId, ...segments))
  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0]
}

export async function runInstalledSkillCommand(
  cmd: string,
  timeout: number,
  skillId: string,
  options: InstalledSkillRunOptions = {},
): Promise<SkillInvocationResult> {
  const start = Date.now()
  try {
    const parsed = parseCommandLine(cmd)
    return await runInstalledSkillCommandArgs(parsed.file, parsed.args, timeout, skillId, { ...options, start })
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
      skillId,
    }
  }
}

export async function runInstalledSkillCommandArgs(
  command: string,
  args: string[],
  timeout: number,
  skillId: string,
  options: InstalledSkillRunOptions & { start?: number } = {},
): Promise<SkillInvocationResult> {
  const start = options.start ?? Date.now()
  try {
    const result = await execa(command, args, {
      timeout,
      reject: false,
      all: false,
      shell: false,
      windowsHide: true,
      cwd: options.cwd,
    })
    return {
      success: (result.exitCode ?? 1) === 0,
      output: result.stdout ?? '',
      error: result.stderr ?? '',
      durationMs: Date.now() - start,
      skillId,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
      skillId,
    }
  }
}

export class InstalledSkillsInvoker {
  async webAccessTargets(): Promise<SkillInvocationResult> {
    return this.runCommandArgs('curl', ['-s', this.webAccessUrl('/targets')], 5000, 'web-access')
  }
  async webAccessNewTab(url: string): Promise<SkillInvocationResult> {
    return this.runCommandArgs('curl', ['-s', this.webAccessUrl('/new', { url })], 30000, 'web-access')
  }
  async webAccessEval(targetId: string, js: string): Promise<SkillInvocationResult> {
    return this.runCommandArgs('curl', ['-s', '-X', 'POST', this.webAccessUrl('/eval', { target: targetId }), '-d', js], 10000, 'web-access')
  }
  async webAccessClick(targetId: string, sel: string): Promise<SkillInvocationResult> {
    return this.runCommandArgs('curl', ['-s', '-X', 'POST', this.webAccessUrl('/click', { target: targetId }), '-d', sel], 10000, 'web-access')
  }
  async webAccessClose(targetId: string): Promise<SkillInvocationResult> {
    return this.runCommandArgs('curl', ['-s', this.webAccessUrl('/close', { target: targetId })], 5000, 'web-access')
  }
  async playwrightOpen(url: string): Promise<SkillInvocationResult> {
    const pw = resolveInstalledSkillPath('playwright', ['scripts', 'playwright_cli.sh'])
    return this.runCommandArgs(pw, ['open', url], 30000, 'playwright')
  }
  async playwrightSnapshot(): Promise<SkillInvocationResult> {
    const pw = resolveInstalledSkillPath('playwright', ['scripts', 'playwright_cli.sh'])
    return this.runCommandArgs(pw, ['snapshot'], 10000, 'playwright')
  }
  async playwrightClick(ref: string): Promise<SkillInvocationResult> {
    const pw = resolveInstalledSkillPath('playwright', ['scripts', 'playwright_cli.sh'])
    return this.runCommandArgs(pw, ['click', ref], 10000, 'playwright')
  }
  async cuaMouseMove(x: number, y: number): Promise<SkillInvocationResult> {
    return this.runCommand('npx @anthropic/mcp-cua mouseMove '+x+' '+y, 10000, 'cua')
  }
  async cuaScreenshot(): Promise<SkillInvocationResult> {
    return this.runCommand('npx @anthropic/mcp-cua screenshot', 10000, 'cua')
  }
  async graphifyBuild(dir: string): Promise<SkillInvocationResult> {
    return this.runCommand('graphify "'+dir+'"', 60000, 'graphify')
  }
  // ========== UI/UX Design Skills ==========
  async uiUxDesignSystem(query: string, projectName?: string): Promise<SkillInvocationResult> {
    const script = resolveInstalledSkillPath('ui-ux-pro-max', ['scripts', 'search.py'])
    const cmd = projectName
      ? `python3 "${script}" "${query}" --design-system -p "${projectName}"`
      : `python3 "${script}" "${query}" --design-system`
    return this.runCommand(cmd, 30000, 'ui-ux-pro-max')
  }
  async uiUxDomainSearch(query: string, domain: string, maxResults?: number): Promise<SkillInvocationResult> {
    const script = resolveInstalledSkillPath('ui-ux-pro-max', ['scripts', 'search.py'])
    const cmd = maxResults
      ? `python3 "${script}" "${query}" --domain ${domain} -n ${maxResults}`
      : `python3 "${script}" "${query}" --domain ${domain}`
    return this.runCommand(cmd, 15000, 'ui-ux-pro-max')
  }
  async uiUxStackGuidelines(query: string, stack: string): Promise<SkillInvocationResult> {
    const script = resolveInstalledSkillPath('ui-ux-pro-max', ['scripts', 'search.py'])
    return this.runCommand(`python3 "${script}" "${query}" --stack ${stack}`, 15000, 'ui-ux-pro-max')
  }
  async awesomeDesignInstall(brand: string): Promise<SkillInvocationResult> {
    return this.runCommand(`npx getdesign@latest add ${brand}`, 30000, 'awesome-design-md')
  }
  // ========== Baoyu Skills (Content Creation) ==========
  private getBunX(): string {
    // Resolve bun runtime: bun if installed, else npx -y bun
    return 'bun'
  }
  private baoyuScript(skillName: string, scriptName: string): string {
    return resolveInstalledSkillPath(skillName, ['scripts', scriptName])
  }
  async baoyuImageGen(prompt: string, options?: { model?: string; aspect?: string; output?: string }): Promise<SkillInvocationResult> {
    const script = this.baoyuScript('baoyu-image-gen', 'main.ts')
    const args = options?.output ? ` --output "${options.output}"` : ''
    const model = options?.model ? ` --model "${options.model}"` : ''
    return this.runCommand(`${this.getBunX()} "${script}" "${prompt}"${model}${args}`, 60000, 'baoyu-image-gen')
  }
  async baoyuInfographic(contentPath: string, options?: { layout?: string; style?: string; aspect?: string; lang?: string }): Promise<SkillInvocationResult> {
    const script = this.baoyuScript('baoyu-infographic', 'main.ts')
    const layout = options?.layout ? ` --layout ${options.layout}` : ''
    const style = options?.style ? ` --style ${options.style}` : ''
    const aspect = options?.aspect ? ` --aspect ${options.aspect}` : ''
    const lang = options?.lang ? ` --lang ${options.lang}` : ''
    return this.runCommand(`${this.getBunX()} "${script}" "${contentPath}"${layout}${style}${aspect}${lang}`, 60000, 'baoyu-infographic')
  }
  async baoyuTranslate(filePath: string, mode?: 'quick' | 'normal' | 'refined'): Promise<SkillInvocationResult> {
    const script = this.baoyuScript('baoyu-translate', 'translate.ts')
    const modeArg = mode ? ` --mode ${mode}` : ''
    return this.runCommand(`${this.getBunX()} "${script}" "${filePath}"${modeArg}`, 120000, 'baoyu-translate')
  }
  async baoyuSlideDeck(contentPath: string, options?: { style?: string; slides?: number; lang?: string }): Promise<SkillInvocationResult> {
    const script = this.baoyuScript('baoyu-slide-deck', 'main.ts')
    const style = options?.style ? ` --style ${options.style}` : ''
    const slides = options?.slides ? ` --slides ${options.slides}` : ''
    const lang = options?.lang ? ` --lang ${options.lang}` : ''
    return this.runCommand(`${this.getBunX()} "${script}" "${contentPath}"${style}${slides}${lang}`, 120000, 'baoyu-slide-deck')
  }
  async baoyuArticleIllustrator(articlePath: string): Promise<SkillInvocationResult> {
    const script = this.baoyuScript('baoyu-article-illustrator', 'main.ts')
    return this.runCommand(`${this.getBunX()} "${script}" "${articlePath}"`, 120000, 'baoyu-article-illustrator')
  }
  async baoyuComic(storyPath: string): Promise<SkillInvocationResult> {
    const script = this.baoyuScript('baoyu-comic', 'main.ts')
    return this.runCommand(`${this.getBunX()} "${script}" "${storyPath}"`, 180000, 'baoyu-comic')
  }
  async baoyuCompressImage(imagePath: string): Promise<SkillInvocationResult> {
    const script = this.baoyuScript('baoyu-compress-image', 'compress.ts')
    return this.runCommand(`${this.getBunX()} "${script}" "${imagePath}"`, 30000, 'baoyu-compress-image')
  }
  async baoyuCoverImage(articlePath: string): Promise<SkillInvocationResult> {
    const script = this.baoyuScript('baoyu-cover-image', 'main.ts')
    return this.runCommand(`${this.getBunX()} "${script}" "${articlePath}"`, 60000, 'baoyu-cover-image')
  }
  async baoyuFormatMarkdown(filePath: string): Promise<SkillInvocationResult> {
    const script = this.baoyuScript('baoyu-format-markdown', 'format.ts')
    return this.runCommand(`${this.getBunX()} "${script}" "${filePath}"`, 30000, 'baoyu-format-markdown')
  }
  async baoyuMarkdownToHtml(filePath: string, theme?: string): Promise<SkillInvocationResult> {
    const script = this.baoyuScript('baoyu-markdown-to-html', 'convert.ts')
    const themeArg = theme ? ` --theme ${theme}` : ''
    return this.runCommand(`${this.getBunX()} "${script}" "${filePath}"${themeArg}`, 30000, 'baoyu-markdown-to-html')
  }
  async baoyuUrlToMarkdown(url: string): Promise<SkillInvocationResult> {
    const script = this.baoyuScript('baoyu-url-to-markdown', 'fetch.ts')
    return this.runCommand(`${this.getBunX()} "${script}" "${url}"`, 60000, 'baoyu-url-to-markdown')
  }
  async baoyuXToMarkdown(url: string): Promise<SkillInvocationResult> {
    const script = this.baoyuScript('baoyu-danger-x-to-markdown', 'main.ts')
    return this.runCommand(`${this.getBunX()} "${script}" "${url}"`, 30000, 'baoyu-danger-x-to-markdown')
  }
  async baoyuXhsImages(url: string): Promise<SkillInvocationResult> {
    const script = this.baoyuScript('baoyu-xhs-images', 'main.ts')
    return this.runCommand(`${this.getBunX()} "${script}" "${url}"`, 60000, 'baoyu-xhs-images')
  }
  // ========== Document Processing Skills ==========
  async pdfExtract(filePath: string): Promise<SkillInvocationResult> {
    return this.runCommandArgs('python3', ['-c', PDF_EXTRACT_CODE, filePath], 30000, 'pdf')
  }
  async pdfMerge(files: string[], outputPath: string): Promise<SkillInvocationResult> {
    return this.runCommandArgs('python3', ['-c', PDF_MERGE_CODE, ...files, outputPath], 30000, 'pdf')
  }
  async docxToMarkdown(filePath: string): Promise<SkillInvocationResult> {
    return this.runCommandArgs('pandoc', [filePath, '-o', `${filePath}.md`], 30000, 'docx')
  }
  async xlsxAnalyze(filePath: string): Promise<SkillInvocationResult> {
    return this.runCommandArgs('python3', ['-c', XLSX_ANALYZE_CODE, filePath], 30000, 'xlsx')
  }
  async pptxToMarkdown(filePath: string): Promise<SkillInvocationResult> {
    return this.runCommandArgs('python', ['-m', 'markitdown', filePath], 30000, 'pptx')
  }
  // ========== Deployment Skills ==========
  async vercelDeploy(path?: string, scope?: string): Promise<SkillInvocationResult> {
    const pathArg = path ? ` "${path}"` : ''
    const scopeArg = scope ? ` --scope ${scope}` : ''
    return this.runCommand(`vercel deploy${pathArg} -y --no-wait${scopeArg}`, 120000, 'deploy-to-vercel')
  }
  async vercelWhoami(): Promise<SkillInvocationResult> {
    return this.runCommand('vercel whoami', 10000, 'deploy-to-vercel')
  }
  // ========== Video/Media Skills ==========
  async remotionRender(projectDir: string, composition: string): Promise<SkillInvocationResult> {
    return this.runCommandArgs('npx', ['remotion', 'render', composition, 'out/video.mp4'], 300000, 'remotion-video', { cwd: projectDir })
  }
  async manimRender(sceneClass: string, quality?: 'low' | 'medium' | 'high'): Promise<SkillInvocationResult> {
    const q = quality === 'low' ? '-ql' : quality === 'medium' ? '-qm' : '-qh'
    return this.runCommand(`manim ${q} "${sceneClass}"`, 300000, 'manim-video')
  }
  // ========== Translation/Search Skills ==========
  async deeplTranslate(text: string, targetLang: string): Promise<SkillInvocationResult> {
    return this.runCommand(`deepl translate --target-lang ${targetLang} "${text}"`, 30000, 'deepl')
  }
  private webAccessUrl(pathname: string, query: Record<string, string> = {}): string {
    const url = new URL(pathname, process.env.SCALE_WEB_ACCESS_BASE_URL ?? 'http://localhost:3456')
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    return url.toString()
  }
  private runCommand(cmd: string, timeout: number, skillId: string): Promise<SkillInvocationResult> {
    return runInstalledSkillCommand(cmd, timeout, skillId)
  }
  private runCommandArgs(
    command: string,
    args: string[],
    timeout: number,
    skillId: string,
    options: InstalledSkillRunOptions = {},
  ): Promise<SkillInvocationResult> {
    return runInstalledSkillCommandArgs(command, args, timeout, skillId, options)
  }
}
export const skillsInvoker = new InstalledSkillsInvoker()
