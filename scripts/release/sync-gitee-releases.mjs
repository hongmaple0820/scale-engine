#!/usr/bin/env node
import process from 'node:process'

const defaults = {
  githubOwner: 'hongmaple0820',
  githubRepo: 'scale-engine',
  giteeOwner: 'hongmaple',
  giteeRepo: 'scale-engine',
  dryRun: false,
  json: false,
}

function parseArgs(argv) {
  const options = { ...defaults }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      index += 1
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`)
      return argv[index]
    }
    if (arg === '--github-owner') options.githubOwner = next()
    else if (arg === '--github-repo') options.githubRepo = next()
    else if (arg === '--gitee-owner') options.giteeOwner = next()
    else if (arg === '--gitee-repo') options.giteeRepo = next()
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function printHelp() {
  process.stdout.write(`Sync GitHub releases to Gitee.

Usage:
  node scripts/release/sync-gitee-releases.mjs [options]

Options:
  --github-owner <owner>  GitHub owner, default hongmaple0820
  --github-repo <repo>    GitHub repo, default scale-engine
  --gitee-owner <owner>   Gitee owner, default hongmaple
  --gitee-repo <repo>     Gitee repo, default scale-engine
  --dry-run               Show missing releases without creating them
  --json                  Emit machine-readable summary
`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
  const giteeToken = process.env.GITEE_TOKEN || ''

  if (!options.dryRun && !giteeToken) {
    throw new Error('GITEE_TOKEN is required unless --dry-run is used.')
  }

  const githubReleases = await listGithubReleases(options, githubToken)
  const publishable = githubReleases.filter(release => !release.draft)
  const giteeReleases = await listGiteeReleases(options, giteeToken)
  const existingTags = new Set(giteeReleases.map(release => release.tag_name).filter(Boolean))
  const missing = publishable.filter(release => !existingTags.has(release.tag_name))
  const created = []
  const skipped = publishable.filter(release => existingTags.has(release.tag_name)).map(release => release.tag_name)

  for (const release of missing) {
    if (options.dryRun) continue
    const createdRelease = await createGiteeRelease(options, giteeToken, release)
    created.push(createdRelease.tag_name ?? release.tag_name)
  }

  const summary = {
    github: `${options.githubOwner}/${options.githubRepo}`,
    gitee: `${options.giteeOwner}/${options.giteeRepo}`,
    sourceReleases: publishable.length,
    existing: skipped.length,
    missing: missing.map(release => release.tag_name),
    created,
    dryRun: options.dryRun,
    assetNote: assetNote(publishable),
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    return
  }

  process.stdout.write([
    `GitHub releases: ${summary.sourceReleases}`,
    `Gitee existing releases: ${summary.existing}`,
    options.dryRun ? `Gitee releases to create: ${summary.missing.length}` : `Gitee releases created: ${summary.created.length}`,
    summary.missing.length ? `Missing tags: ${summary.missing.join(', ')}` : 'Missing tags: none',
    summary.assetNote,
    '',
  ].filter(Boolean).join('\n'))
}

async function listGithubReleases(options, token) {
  const releases = []
  for (let page = 1; ; page += 1) {
    const url = `https://api.github.com/repos/${options.githubOwner}/${options.githubRepo}/releases?per_page=100&page=${page}`
    const batch = await requestJson(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    if (!Array.isArray(batch) || batch.length === 0) break
    releases.push(...batch)
    if (batch.length < 100) break
  }
  return releases
}

async function listGiteeReleases(options, token) {
  const releases = []
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({ per_page: '100', page: String(page) })
    if (token) params.set('access_token', token)
    const url = `https://gitee.com/api/v5/repos/${options.giteeOwner}/${options.giteeRepo}/releases?${params}`
    const batch = await requestJson(url)
    if (!Array.isArray(batch) || batch.length === 0) break
    releases.push(...batch)
    if (batch.length < 100) break
  }
  return releases
}

async function createGiteeRelease(options, token, githubRelease) {
  const url = `https://gitee.com/api/v5/repos/${options.giteeOwner}/${options.giteeRepo}/releases`
  const params = new URLSearchParams({
    access_token: token,
    tag_name: githubRelease.tag_name,
    name: githubRelease.name || githubRelease.tag_name,
    body: buildGiteeBody(options, githubRelease),
    prerelease: String(Boolean(githubRelease.prerelease)),
  })
  if (githubRelease.target_commitish) params.set('target_commitish', githubRelease.target_commitish)

  return requestJson(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })
}

function buildGiteeBody(options, release) {
  const lines = []
  if (release.body) lines.push(release.body.trim())
  lines.push('', '---')
  lines.push(`Synced from GitHub release: https://github.com/${options.githubOwner}/${options.githubRepo}/releases/tag/${encodeURIComponent(release.tag_name)}`)
  if (release.published_at) lines.push(`Published at: ${release.published_at}`)
  if (Array.isArray(release.assets) && release.assets.length > 0) {
    lines.push('', 'GitHub release assets:')
    for (const asset of release.assets) {
      lines.push(`- ${asset.name}: ${asset.browser_download_url}`)
    }
  }
  return lines.join('\n')
}

function assetNote(releases) {
  const assetCount = releases.reduce((sum, release) => sum + (Array.isArray(release.assets) ? release.assets.length : 0), 0)
  if (assetCount === 0) return ''
  return `Note: ${assetCount} GitHub release asset(s) are linked in Gitee release notes; binary asset upload is not mirrored by this script.`
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init)
  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'message' in payload
      ? payload.message
      : text.slice(0, 300)
    throw new Error(`${init.method ?? 'GET'} ${url.replace(/access_token=[^&]+/g, 'access_token=***')} failed: ${response.status} ${message}`)
  }
  return payload
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
