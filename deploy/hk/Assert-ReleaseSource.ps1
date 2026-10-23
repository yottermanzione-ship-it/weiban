[CmdletBinding()]
param(
    [string]$Ref = 'HEAD',
    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [string]$Server = '103.231.58.124',
    [string]$IdentityFile = (Join-Path $env:USERPROFILE '.ssh/weiban_deploy'),
    # Explicit local-first release mode, authorized by the operator; never skips ancestry checks.
    [switch]$LocalOnly,
    [string]$LocalIntegrationPath = (Join-Path $env:USERPROFILE 'Desktop/weiban')
)

# Read-only release guard: an old task branch must never replace the consolidated live version.
$ErrorActionPreference = 'Stop'
$releaseRoot = (& git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot locate the release repository.' }
if (-not $LocalOnly) {
    & git -C $releaseRoot fetch origin main
    if ($LASTEXITCODE -ne 0) { throw 'Cannot verify the latest remote main.' }
}
$releaseCommit = (& git -C $releaseRoot rev-parse --verify --end-of-options "$Ref^{commit}").Trim()
if ($LASTEXITCODE -ne 0) { throw 'Release ref is not a commit.' }
# Retain the last observed remote-main check even when an offline/local-first release is requested.
& git -C $releaseRoot merge-base --is-ancestor origin/main $releaseCommit
if ($LASTEXITCODE -ne 0) { throw 'Release source omits changes already observed on main. Integrate main first.' }
if ($LocalOnly) {
    foreach ($localRef in @('refs/heads/main', 'refs/heads/local/trunk')) {
        & git -C $releaseRoot show-ref --verify --quiet $localRef
        if ($LASTEXITCODE -eq 0) {
            & git -C $releaseRoot merge-base --is-ancestor $localRef $releaseCommit
            if ($LASTEXITCODE -ne 0) { throw "Release source omits local integration ref $localRef." }
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $LocalIntegrationPath '.git'))) {
        throw 'Cannot inspect the shared local integration checkout.'
    }
    $integrationCommit = (& git -C $LocalIntegrationPath rev-parse --verify HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve shared local integration HEAD.' }
    & git -C $releaseRoot merge-base --is-ancestor $integrationCommit $releaseCommit
    if ($LASTEXITCODE -ne 0) { throw 'Release source omits the shared local integration HEAD. Integrate it first.' }
    Write-Output "Local-first mode: checked local main/trunk, last observed origin/main, and shared HEAD $integrationCommit; no remote fetch claimed."
}

$sourceChanges = @(
    & git -C $releaseRoot diff --name-only
    & git -C $releaseRoot diff --cached --name-only
    & git -C $releaseRoot ls-files --others --exclude-standard
) | Where-Object { $_ -match '^(apps/|packages/|scripts/|deploy/|package\.json$|pnpm-|tsconfig|eslint|\.dependency-cruiser)' }
if ($sourceChanges.Count -gt 0) {
    throw 'Uncommitted source files would be omitted from git archive. Commit and integrate them first.'
}

$liveManifest = & ssh -o BatchMode=yes -o ConnectTimeout=15 -i $IdentityFile "root@$Server" 'cat /srv/weiban/deployment-version.txt'
if ($LASTEXITCODE -ne 0) { throw 'Cannot read the current live release identity.' }
$liveMatch = [regex]::Match(($liveManifest -join "`n"), '(?m)^sourceCommit=([a-f0-9]{40})\r?$')
if (-not $liveMatch.Success) { throw 'Live release has no verifiable full commit identity. Inventory the server first.' }
$liveCommit = $liveMatch.Groups[1].Value
& git -C $releaseRoot merge-base --is-ancestor $liveCommit $releaseCommit
if ($LASTEXITCODE -ne 0) { throw 'Release source would omit the live version. Integrate it before deployment.' }

Write-Output "Verified release source: $releaseCommit (includes origin/main and live $liveCommit)."
Write-Output 'This verifies the source only; it does not deploy or grant deployment permission.'
