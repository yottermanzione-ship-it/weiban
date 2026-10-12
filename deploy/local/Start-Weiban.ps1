param(
    [string]$RuntimeRoot = 'C:\wb-local',
    [switch]$PrepareOnly,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runtimePath = [IO.Path]::GetFullPath($RuntimeRoot)
$secretPath = Join-Path $runtimePath 'secrets'
$configPath = Join-Path $runtimePath 'runtime.env'
$utf8 = [Text.UTF8Encoding]::new($false)
$existingVolumes = @(& docker volume ls --filter 'label=com.docker.compose.project=weiban-local' --format '{{.Name}}')
if ($LASTEXITCODE -ne 0) { throw '无法检查本机数据卷；请先启动 Docker Desktop。' }
if ($existingVolumes.Count -gt 0) {
    foreach ($name in @('postgres-password', 'database-url', 'kek')) {
        if (-not (Test-Path -LiteralPath (Join-Path $secretPath $name))) {
            throw "本机已有数据卷但缺少原秘密文件：$name。请恢复原配置和密钥，禁止生成替代密钥。"
        }
    }
}
New-Item -ItemType Directory -Force -Path $secretPath | Out-Null

function New-RandomSecret {
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes); return [Convert]::ToBase64String($bytes) }
    finally { $generator.Dispose(); [Array]::Clear($bytes, 0, $bytes.Length) }
}

if (-not (Test-Path -LiteralPath $configPath)) {
    $passwordPath = Join-Path $secretPath 'postgres-password'
    $databasePath = Join-Path $secretPath 'database-url'
    $kekPath = Join-Path $secretPath 'kek'
    if (-not (Test-Path -LiteralPath $passwordPath)) {
        [IO.File]::WriteAllText($passwordPath, (New-RandomSecret), $utf8)
    }
    if (-not (Test-Path -LiteralPath $kekPath)) {
        [IO.File]::WriteAllText($kekPath, (New-RandomSecret), $utf8)
    }
    if (-not (Test-Path -LiteralPath $databasePath)) {
        $password = [IO.File]::ReadAllText($passwordPath).Trim()
        $databaseUrl = 'postgres://weiban:' + [Uri]::EscapeDataString($password) + '@postgres:5432/weiban'
        [IO.File]::WriteAllText($databasePath, $databaseUrl, $utf8)
        $password = $null
        $databaseUrl = $null
    }
    $secretDirectory = $secretPath.Replace('\', '/')
    $configuration = @"
SECRETS_DIR=$secretDirectory
WEB_HOST=localhost:8080
WEB_DOMAIN=http://localhost:8080
ADMIN_DOMAIN=http://localhost:8081
ADMIN_PUBLIC_ORIGIN=http://localhost:8081
BILLING_PLATFORM_DAILY_CAP_MICROS=20000000
PLATFORM_KEK_VERSION=1
APP_IMAGE=weiban-app:desktop
EDGE_IMAGE=weiban-edge:desktop
"@
    [IO.File]::WriteAllText($configPath, $configuration, $utf8)
}
foreach ($name in @('postgres-password', 'database-url', 'kek')) {
    if (-not (Test-Path -LiteralPath (Join-Path $secretPath $name))) {
        throw "配置已存在但缺少秘密文件：$name。请恢复原文件，不要重新生成已使用的密钥。"
    }
}

$composeArgs = @('compose', '--project-name', 'weiban-local', '--env-file', $configPath,
    '-f', (Join-Path $sourceRoot 'deploy/prod/compose.yml'),
    '-f', (Join-Path $sourceRoot 'deploy/local/compose.override.yml'))
& docker @composeArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw '本机部署配置校验失败' }
if ($PrepareOnly) { Write-Output '本机配置已准备并校验；尚未启动。'; return }
if (-not $SkipBuild) {
    & docker @composeArgs build
    if ($LASTEXITCODE -ne 0) { throw '镜像构建失败' }
}
& docker @composeArgs up -d --wait
if ($LASTEXITCODE -ne 0) { throw '本机部署启动失败' }
Write-Output '用户端：http://localhost:8080'
Write-Output '管理后台：http://localhost:8081'
