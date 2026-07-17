$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir '..\..')
$stateDir = Join-Path $env:TEMP 'vrcx0-overlay-devtool'
$stdoutLog = Join-Path $stateDir 'overlay-devtool.stdout.log'
$stderrLog = Join-Path $stateDir 'overlay-devtool.stderr.log'
$port = 47391

if ($env:VRCX_OVERLAY_DEVTOOL_PORT) {
    $port = [int]$env:VRCX_OVERLAY_DEVTOOL_PORT
}

$url = "http://127.0.0.1:$port/"
$stateUrl = "${url}api/state"

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $stdoutLog, $stderrLog

$process = $null

try {
    Push-Location $repoRoot

    rtk cargo build --manifest-path Cargo.toml -p vrcx-0-overlay-devtool

    $exe = Join-Path $repoRoot 'target\debug\vrcx-0-overlay-devtool.exe'
    if (-not (Test-Path $exe)) {
        throw "Overlay devtool binary was not built: $exe"
    }

    $env:VRCX_OVERLAY_DEVTOOL_PORT = [string]$port
    $process = Start-Process `
        -FilePath $exe `
        -WorkingDirectory $repoRoot `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -PassThru `
        -WindowStyle Hidden

    $ready = $false
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if ($process.HasExited) {
            break
        }
        try {
            Invoke-WebRequest -Uri $stateUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
            $ready = $true
            break
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    if (-not $ready) {
        Write-Host "Overlay devtool logs:"
        Write-Host "  $stdoutLog"
        Write-Host "  $stderrLog"
        Get-Content $stderrLog -ErrorAction SilentlyContinue -Tail 80
        throw "Overlay devtool did not become ready at $url"
    }

    Write-Host "Overlay devtool: $url"
    Write-Host "Press Ctrl+C in this terminal to stop the overlay-devtool."
    Write-Host "Logs:"
    Write-Host "  $stdoutLog"
    Write-Host "  $stderrLog"
    Start-Process $url
    Wait-Process -Id $process.Id
}
finally {
    Pop-Location
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
    }
}
