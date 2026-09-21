import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import { DEFAULT_POLICY, PolicyCompiler } from './PolicyCompiler.js'

export interface ShieldActivationReport {
  ok: boolean
  /** Hook script paths written by the compile step. */
  hooks: string[]
  /** Settings files that received hook registrations. */
  registered: string[]
  /** Policy file written when the project had none; undefined when one already existed. */
  policyPath?: string
  policyHash: string
  message: string
  warnings: string[]
}

/**
 * Compile the Shield policy and register the hooks in the agent settings.
 *
 * Project initialization must call this: without it the compiled hook scripts and
 * their settings registrations never exist, so every Shield rule (dangerous-command
 * blocking, protected paths, the dirty-worktree stop check) stays inert for the
 * installed project. Registration only touches settings files that already exist,
 * because the hooks cannot run before an agent config is present.
 */
export function activateShield(projectDir: string, options: { scaleDir?: string } = {}): ShieldActivationReport {
  const scaleDir = options.scaleDir ?? join(projectDir, '.scale')
  const warnings: string[] = []
  const policyPath = join(scaleDir, 'policy.yaml')
  let writtenPolicy: string | undefined
  if (!existsSync(policyPath)) {
    // Ship an editable policy file so the rules are discoverable and tunable;
    // without it every project silently runs the built-in defaults.
    try {
      writeFileSync(policyPath, renderPolicyYaml(), 'utf-8')
      writtenPolicy = policyPath
    } catch (error) {
      warnings.push(`Could not write ${policyPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const compiler = new PolicyCompiler()
  let output
  try {
    output = compiler.compile(projectDir)
  } catch (error) {
    return {
      ok: false,
      hooks: [],
      registered: [],
      policyPath: writtenPolicy,
      policyHash: '',
      message: `Shield compile failed: ${error instanceof Error ? error.message : String(error)}`,
      warnings,
    }
  }
  const hooks = output.hooks.map(hook => hook.scriptPath)
  const registered: string[] = []
  try {
    compiler.writeSettingsPatches(output)
  } catch (error) {
    warnings.push(`Shield hook registration failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  for (const settingsPath of [output.settingsPatches.claude, output.settingsPatches.codex, output.settingsPatches.cursor]) {
    if (existsSync(settingsPath)) registered.push(settingsPath)
  }
  if (registered.length === 0) {
    warnings.push('No agent settings file found; compiled hooks are not registered yet. Run `scale shield compile` after configuring an agent.')
  }
  return {
    ok: true,
    hooks,
    registered,
    policyPath: writtenPolicy,
    policyHash: output.policyHash,
    message: registered.length > 0
      ? `Shield active: ${output.hooks.length} hook(s) compiled, registered in ${registered.length} settings file(s).`
      : `Shield compiled ${output.hooks.length} hook(s); registration pending an agent settings file.`,
    warnings,
  }
}

/** Default policy serialized for a project-level `.scale/policy.yaml`. */
export function renderPolicyYaml(): string {
  return `# SCALE Shield policy — compiled into runtime hooks by \`scale shield compile\`.\n# Generated from the built-in defaults; edit and re-run \`scale shield compile\` to apply.\n${yaml.dump(DEFAULT_POLICY, { lineWidth: 120 })}`
}

/** Directories that contain generated hook scripts, for install-time commit scoping. */
export function shieldArtifactDirs(projectDir: string): string[] {
  const hooksDir = join(projectDir, '.claude', 'hooks')
  return [hooksDir, dirname(hooksDir)]
}
