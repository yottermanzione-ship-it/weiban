param(
    [string]$RuntimeRoot = 'C:\wb-local',
    [string]$BackupRoot = 'C:\wb-local\backups'
)

$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runtimePath = [IO.Path]::GetFullPath($RuntimeRoot)
$backupPath = [IO.Path]::GetFullPath($BackupRoot)
if ($backupPath.StartsWith($sourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $backupPath -eq $sourceRoot) {
    throw '备份包含原密钥，必须保存在 Git 工作区之外。'
}
foreach ($name in @('runtime.env', 'secrets/postgres-password', 'secrets/database-url', 'secrets/kek')) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtimePath $name))) { throw "缺少原配置文件：$name" }
}
$composeArgs = @('compose', '--project-name', 'weiban-local', '--env-file', (Join-Path $runtimePath 'runtime.env'),
    '-f', (Join-Path $sourceRoot 'deploy/prod/compose.yml'),
    '-f', (Join-Path $sourceRoot 'deploy/local/compose.override.yml'))
& docker @composeArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw '部署配置校验失败' }
$appId = (& docker @composeArgs ps -q app).Trim()
$postgresId = (& docker @composeArgs ps -q postgres).Trim()
if (-not $appId -or -not $postgresId) { throw '备份前应用和数据库必须正在运行。' }
$destination = Join-Path $backupPath ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$restartNeeded = $false
try {
    $restartNeeded = $true
    & docker @composeArgs stop app
    if ($LASTEXITCODE -ne 0) { throw '停止应用失败，未开始备份' }
    & docker exec $postgresId pg_dump -U weiban -d weiban -Fc -f /tmp/weiban-backup.dump
    if ($LASTEXITCODE -ne 0) { throw '数据库备份失败' }
    & docker cp "${postgresId}:/tmp/weiban-backup.dump" (Join-Path $destination 'database.dump')
    if ($LASTEXITCODE -ne 0) { throw '数据库备份复制失败' }
    # 应用停止后通过同一生产镜像只读挂载媒体卷，避免数据库与媒体在备份中继续变化。
    & docker run --rm --network none --volumes-from "${appId}:ro" --mount "type=bind,source=$destination,target=/backup" --entrypoint tar weiban-app:desktop -czf /backup/media.tar.gz -C /app/.data/media .
    if ($LASTEXITCODE -ne 0) { throw '媒体备份失败' }
    New-Item -ItemType Directory -Path (Join-Path $destination 'secrets') | Out-Null
    foreach ($name in @('postgres-password', 'database-url', 'kek')) {
        Copy-Item -LiteralPath (Join-Path $runtimePath "secrets/$name") -Destination (Join-Path $destination "secrets/$name")
    }
    foreach ($name in @('runtime.env', 'admin-login.json', 'deployment-version.txt')) {
        $file = Join-Path $runtimePath $name
        if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination $destination }
    }
    $files = Get-ChildItem -LiteralPath $destination -File -Recurse | ForEach-Object {
        @{ path = $_.FullName.Substring($destination.Length + 1).Replace('\', '/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash; bytes = $_.Length }
    }
    @{ format = 1; createdAt = [DateTime]::UtcNow.ToString('o'); files = @($files) } |
        ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $destination 'manifest.json') -Encoding UTF8
    Write-Output "备份完成：$destination。包含原密钥及登录资料，请保管在本人控制的目录。"
} finally {
    & docker exec $postgresId rm -f /tmp/weiban-backup.dump
    if ($LASTEXITCODE -ne 0) { Write-Warning '数据库容器中的临时备份未清理，请检查 /tmp/weiban-backup.dump。' }
    if ($restartNeeded) {
        & docker @composeArgs start app
        if ($LASTEXITCODE -ne 0) { throw '应用恢复启动失败，请按本机部署文档启动。' }
    }
}
