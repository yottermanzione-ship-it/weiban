param(
    [Parameter(Mandatory = $true)][string]$BackupDirectory,
    [Parameter(Mandatory = $true)][string]$IdentityFile,
    [string]$RuntimeRoot = 'C:\wb-local',
    [ValidatePattern('^weiban-restore-[a-z0-9][a-z0-9_-]*$')][string]$ProjectName = 'weiban-restore-check',
    [string]$AgeExecutable = 'age'
)

$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$bundle = [IO.Path]::GetFullPath($BackupDirectory)
$runtimePath = [IO.Path]::GetFullPath($RuntimeRoot)
$manifest = Get-Content -LiteralPath (Join-Path $bundle 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.format -ne 2 -or $manifest.kekBackup -ne 'separate-required' -or $manifest.files.Count -ne 2) {
    throw '只接受格式2的独立加密数据备份，原 KEK 必须另行恢复。'
}
foreach ($name in @('database.dump.age', 'media.tar.gz.age')) {
    $record = @($manifest.files | Where-Object path -eq $name)
    if ($record.Count -ne 1 -or (Get-FileHash -LiteralPath (Join-Path $bundle $name) -Algorithm SHA256).Hash -ne $record[0].sha256) {
        throw "备份清单或校验值不匹配：$name"
    }
}
foreach ($name in @('runtime.env', 'secrets/postgres-password', 'secrets/database-url', 'secrets/kek')) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtimePath $name))) { throw "请先单独恢复原配置：$name" }
}
if (-not (Test-Path -LiteralPath $IdentityFile)) { throw '缺少单独保管的 age 解密身份' }
$existing = @(& docker volume ls --filter "label=com.docker.compose.project=$ProjectName" --format '{{.Name}}')
if ($LASTEXITCODE -ne 0) { throw '无法检查恢复项目的数据卷' }
if ($existing.Count -gt 0) { throw '目标恢复项目已有数据卷；请选择全新的恢复项目，禁止覆盖。' }
$composeArgs = @('compose', '--project-name', $ProjectName, '--env-file', (Join-Path $runtimePath 'runtime.env'),
    '-f', (Join-Path $sourceRoot 'deploy/prod/compose.yml'),
    '-f', (Join-Path $sourceRoot 'deploy/local/compose.override.yml'))
& docker @composeArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw '恢复配置校验失败' }
$staging = Join-Path $runtimePath ('restore-staging-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
$postgresId = $null
try {
    foreach ($name in @('database.dump', 'media.tar.gz')) {
        & $AgeExecutable -d -i $IdentityFile -o (Join-Path $staging $name) (Join-Path $bundle "$name.age")
        if ($LASTEXITCODE -ne 0) { throw "备份解密失败：$name" }
    }
    & docker @composeArgs up -d --wait postgres
    if ($LASTEXITCODE -ne 0) { throw '恢复数据库启动失败' }
    $postgresId = (& docker @composeArgs ps -q postgres).Trim()
    & docker cp (Join-Path $staging 'database.dump') "${postgresId}:/tmp/weiban-restore.dump"
    if ($LASTEXITCODE -ne 0) { throw '恢复文件复制失败' }
    & docker exec $postgresId pg_restore -U weiban -d weiban --single-transaction --exit-on-error /tmp/weiban-restore.dump
    if ($LASTEXITCODE -ne 0) { throw '数据库恢复失败；未启动应用，保留恢复项目供检查。' }
    $mediaVolume = "${ProjectName}_media"
    & docker volume create --label "com.docker.compose.project=$ProjectName" --label 'com.docker.compose.volume=media' $mediaVolume
    if ($LASTEXITCODE -ne 0) { throw '恢复媒体卷创建失败' }
    # 镜像通过已解析的Compose配置获取；不输出带配置细节的完整config。
    $config = (& docker @composeArgs config --format json) | ConvertFrom-Json
    & docker run --rm --network none --user root --mount "type=volume,source=$mediaVolume,target=/media" --mount "type=bind,source=$staging,target=/probe,readonly" --entrypoint sh $config.services.app.image -c 'tar xzf /probe/media.tar.gz -C /media && chown -R node:node /media'
    if ($LASTEXITCODE -ne 0) { throw '媒体恢复失败；未启动应用，保留恢复项目供检查。' }
    & docker @composeArgs up -d --wait app
    if ($LASTEXITCODE -ne 0) { throw '恢复应用健康检查失败，请核对原 KEK 和应用版本。' }
    Write-Output "隔离恢复环境已启动：$ProjectName；未启动Caddy或开放入口，不替换weiban-local。请验证实际加密数据及媒体后再安排切换。"
} finally {
    if ($postgresId) {
        & docker exec $postgresId rm -f /tmp/weiban-restore.dump
        if ($LASTEXITCODE -ne 0) { Write-Warning '恢复容器中的临时dump未清理。' }
    }
    foreach ($name in @('database.dump', 'media.tar.gz')) {
        $file = Join-Path $staging $name
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
    Remove-Item -LiteralPath $staging
}
