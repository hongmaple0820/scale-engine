#!/usr/bin/env node
// Verification plan generator for scripts/workflow/verify.sh.
//
// Emits one tab-separated line per action:
//   ERROR\t<message>
//   SKIP\t<service>\t<path>\t<check>\t<reason>
//   RUN\t<service>\t<path>\t<check>\t<tools>\t<command>
//
// Node is used instead of python3 because Node >= 22 is a hard requirement of
// this repository, while python3 may be absent or unusable (e.g. the Windows
// App Execution Alias stub, which exits 49 and broke `verify` silently).
import { readFileSync } from 'node:fs'

function fail(message) {
  process.stdout.write(`ERROR\t${message}\n`)
  process.exit(0)
}

const [configPath, profileName, selectedService] = process.argv.slice(2)

if (!configPath) fail('verify-plan: missing config path')
if (!profileName) fail('verify-plan: missing profile name')

let cfg
try {
  cfg = JSON.parse(readFileSync(configPath, 'utf-8'))
} catch (error) {
  fail(`verify-plan: cannot read ${configPath}: ${error.message}`)
}

const profiles = cfg.profiles ?? {}
const services = cfg.services ?? {}
const stacks = cfg.stacks ?? {}

if (selectedService) {
  emit(selectedService, (profiles[profileName] ?? {}).checks ?? ['lint', 'test'])
} else {
  const profile = profiles[profileName]
  if (!profile) fail(`unknown profile: ${profileName}`)
  let serviceNames = profile.services ?? []
  const checks = profile.checks ?? ['lint', 'test']
  if (serviceNames === '*') serviceNames = Object.keys(services).sort()
  if (serviceNames.length === 0) fail(`profile has no services: ${profileName}`)
  for (const name of serviceNames) emit(name, checks)
}

function emit(name, checks) {
  const service = services[name]
  if (!service) {
    process.stdout.write(`ERROR\tunknown service: ${name}\n`)
    return
  }
  const stack = stacks[service.stack ?? 'custom'] ?? {}
  const commands = { ...(stack.commands ?? {}), ...(service.commands ?? {}) }
  const requiredTools = { ...(stack.required_tools ?? {}), ...(service.required_tools ?? {}) }
  const path = service.path ?? '.'
  for (const check of checks) {
    const command = commands[check]
    if (!command) {
      process.stdout.write(`SKIP\t${name}\t${path}\t${check}\tno command configured\n`)
      continue
    }
    const tools = (requiredTools[check] ?? []).join(',') || '-'
    process.stdout.write(`RUN\t${name}\t${path}\t${check}\t${tools}\t${command}\n`)
  }
}
