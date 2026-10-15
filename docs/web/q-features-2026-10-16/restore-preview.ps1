param([string]$Worktree = 'C:\wb-dev\wb-qfeat')
$resolvedRoot = (Resolve-Path -LiteralPath $Worktree).Path
if (-not (Test-Path -LiteralPath (Join-Path $resolvedRoot 'apps\web\package.json'))) { throw '请指定微伴独立worktree根目录。' }
foreach ($fileName in @('q-preview.html','q-preview.tsx','q-preview-api.ts','q-preview.config.ts')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot ($fileName + '.fixture.txt')) -Destination (Join-Path $resolvedRoot ('apps\web\' + $fileName))
}
Write-Output '已恢复4个本地组件样例文件。请在apps/web运行：pnpm exec vite --config q-preview.config.ts --host 127.0.0.1'
