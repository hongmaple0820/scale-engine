param(
  [switch]$DryRun,
  [ValidateSet('workflow', 'quality', 'fast-lane', 'all')]
  [string]$Mode = 'all'
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')

function Resolve-Bash {
  $candidates = @(
    'C:\Program Files\Git\bin\bash.exe',
    'C:\Program Files\Git\usr\bin\bash.exe',
    'C:\Program Files (x86)\Git\bin\bash.exe'
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }
  $pathBash = Get-Command bash.exe -ErrorAction SilentlyContinue
  if ($pathBash -and $pathBash.Source -notlike '*\System32\bash.exe') {
    return $pathBash.Source
  }
  throw 'Git Bash was not found.'
}

$Bash = Resolve-Bash
Push-Location $Root
try {
  $args = @('scripts/gates/all.sh', "--$Mode")
  if ($DryRun) {
    $args += '--dry-run'
  }
  & $Bash @args
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}
