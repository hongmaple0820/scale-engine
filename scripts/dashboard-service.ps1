param(
  [ValidateSet('ensure', 'start', 'stop', 'restart', 'status', 'logs', 'install', 'uninstall')]
  [string]$Action = 'ensure',
  [string]$ProjectDir = (Get-Location).Path,
  [int]$Port = 3210,
  [string]$HostName = '127.0.0.1',
  [switch]$Json
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$cli = Join-Path $root 'dist\api\cli.js'

if (-not (Test-Path $cli)) {
  Push-Location $root
  try {
    npm run build
  } finally {
    Pop-Location
  }
}

$argsList = @(
  $cli,
  'dashboard',
  'daemon',
  $Action,
  '--dir',
  $ProjectDir,
  '--port',
  [string]$Port,
  '--host',
  $HostName
)

if ($Json) {
  $argsList += '--json'
}

& node @argsList
