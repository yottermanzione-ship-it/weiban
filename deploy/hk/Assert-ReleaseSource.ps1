[CmdletBinding()]
param(
    [string]$Ref = 'HEAD',
    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [string]$Server = '103.231.58.124',
    [string]$IdentityFile = (Join-Path $env:USERPROFILE '.ssh/weiban_deploy')
)

# Read-only release guard: an old task branch must never replace the consolidated live version.
$ErrorActionPreference = 'Stop'
$releaseRoot = (& git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot locate the release repository.' }
& git -C $releaseRoot fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify the latest remote main.' }
$releaseCommit = (& git -C $releaseRoot rev-parse --verify --end-of-options "$Ref^{commit}").Trim()
if ($LASTEXITCODE -ne 0) { throw 'Release ref is not a commit.' }
& git -C $releaseRoot merge-base --is-ancestor origin/main $releaseCommit
if ($LASTEXITCODE -ne 0) { throw 'Release source omits changes already merged into main. Integrate main first.' }

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
