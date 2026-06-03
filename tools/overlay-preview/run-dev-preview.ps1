$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir '..\..')
$previewDir = Join-Path $env:TEMP 'vrcx0-overlay-preview'
$previewPath = Join-Path $previewDir 'wrist.json'
$previewStdout = Join-Path $previewDir 'preview.stdout.log'
$previewStderr = Join-Path $previewDir 'preview.stderr.log'

New-Item -ItemType Directory -Force -Path $previewDir | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $previewPath

$env:VRCX0_OVERLAY_PREVIEW = '1'
$env:VRCX0_OVERLAY_PREVIEW_PATH = $previewPath

$previewArgs = @(
    'cargo',
    'run',
    '--manifest-path',
    'tools/overlay-preview/Cargo.toml',
    '--',
    '--live',
    '--path',
    $previewPath
)

$previewProcess = Start-Process `
    -FilePath 'rtk' `
    -ArgumentList $previewArgs `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $previewStdout `
    -RedirectStandardError $previewStderr `
    -PassThru `
    -WindowStyle Hidden

try {
    Push-Location $repoRoot
    npm run tauri:dev
}
finally {
    Pop-Location
    if ($previewProcess -and -not $previewProcess.HasExited) {
        Stop-Process -Id $previewProcess.Id -Force
    }
    Write-Host "Overlay preview logs:"
    Write-Host "  $previewStdout"
    Write-Host "  $previewStderr"
}
