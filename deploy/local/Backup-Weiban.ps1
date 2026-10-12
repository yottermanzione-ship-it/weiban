param(
    [string]$RuntimeRoot = 'C:\wb-local',
    [string]$BackupRoot = 'C:\wb-local\backups',
    [ValidatePattern('^[a-z0-9][a-z0-9_-]*$')][string]$ProjectName = 'weiban-local',
    [Parameter(Mandatory = $true)][string]$RecipientFile,
    [string]$AgeExecutable = 'age'
)

$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runtimePath = [IO.Path]::GetFullPath($RuntimeRoot)
$backupPath = [IO.Path]::GetFullPath($BackupRoot)
if ($backupPath.StartsWith($sourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $backupPath -eq $sourceRoot) {
    throw '数据备份必须保存在 Git 工作区之外。'
}
if (-not (Test-Path -LiteralPath $RecipientFile)) { throw '缺少 age 公钥接收者文件；解密身份与原 KEK 必须另行保管。' }
& $AgeExecutable --version
if ($LASTEXITCODE -ne 0) { throw 'age 不可用' }
foreach ($name in @('runtime.env', 'secrets/postgres-password', 'secrets/database-url', 'secrets/kek')) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtimePath $name))) { throw "缺少原配置文件：$name" }
}
$composeArgs = @('compose', '--project-name', $ProjectName, '--env-file', (Join-Path $runtimePath 'runtime.env'),
    '-f', (Join-Path $sourceRoot 'deploy/prod/compose.yml'),
    '-f', (Join-Path $sourceRoot 'deploy/local/compose.override.yml'))
& docker @composeArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw '部署配置校验失败' }
$appId = (& docker @composeArgs ps -q app).Trim()
$postgresId = (& docker @composeArgs ps -q postgres).Trim()
if (-not $appId -or -not $postgresId) { throw '备份前应用和数据库必须正在运行。' }
$appImage = (& docker inspect --format '{{.Image}}' $appId).Trim()
if ($LASTEXITCODE -ne 0 -or -not $appImage) { throw '无法确定正在使用的应用镜像' }
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
    & docker run --rm --network none --volumes-from "${appId}:ro" --mount "type=bind,source=$destination,target=/backup" --entrypoint tar $appImage -czf /backup/media.tar.gz -C /app/.data/media .
    if ($LASTEXITCODE -ne 0) { throw '媒体备份失败' }
    foreach ($name in @('database.dump', 'media.tar.gz')) {
        $plain = Join-Path $destination $name
        & $AgeExecutable -R $RecipientFile -o "$plain.age" $plain
        if ($LASTEXITCODE -ne 0) { throw "age 加密失败：$name" }
        Remove-Item -LiteralPath $plain -Force
    }
    $files = Get-ChildItem -LiteralPath $destination -File -Recurse | ForEach-Object {
        @{ path = $_.FullName.Substring($destination.Length + 1).Replace('\', '/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash; bytes = $_.Length }
    }
    @{ format = 2; createdAt = [DateTime]::UtcNow.ToString('o'); kekBackup = 'separate-required'; storage = 'disk'; files = @($files) } |
        ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $destination 'manifest.json') -Encoding UTF8
    Write-Output "加密数据备份完成：$destination。原 KEK 和 age 解密身份须在备份之外分别保管。"
} finally {
    try {
        foreach ($name in @('database.dump', 'media.tar.gz')) {
            $plain = Join-Path $destination $name
            if (Test-Path -LiteralPath $plain) { Remove-Item -LiteralPath $plain -Force }
        }
        & docker exec $postgresId rm -f /tmp/weiban-backup.dump
        if ($LASTEXITCODE -ne 0) { Write-Warning '数据库容器中的临时备份未清理，请检查 /tmp/weiban-backup.dump。' }
    } finally {
        if ($restartNeeded) {
            & docker @composeArgs start app
            if ($LASTEXITCODE -ne 0) { throw '应用恢复启动失败，请按本机部署文档启动。' }
        }
    }
}
