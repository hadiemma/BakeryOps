param(
    [switch]$Force
)

$ErrorActionPreference = "SilentlyContinue"
$projectDir = "C:\Users\hadis\.switch\agents\localhost-57168\bakeryops-codex"
$taskName = "BakeryOpsServer"

# Check if port 3000 is already active
$connections = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($connections) {
    Write-Host "[BakeryOps] Server is already running on http://localhost:3000 (Port 3000 is active)."
    exit 0
}

# Ensure scheduled task exists
$taskExists = schtasks.exe /Query /TN $taskName 2>$null
if (-not $taskExists) {
    $batPath = Join-Path $projectDir "scripts\run-server.bat"
    schtasks.exe /Create /TN $taskName /TR "$batPath" /SC ONCE /ST 23:59 /F | Out-Null
}

Write-Host "[BakeryOps] Starting server in detached background process..."
schtasks.exe /Run /TN $taskName | Out-Null

# Wait up to 15 seconds for the server to listen on port 3000
$started = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    $conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $started = $true
        break
    }
}

if ($started) {
    Write-Host "[BakeryOps] Server successfully started and live at http://localhost:3000"
    Write-Host "[BakeryOps] Logs: $projectDir\logs\bakeryops.log"
} else {
    Write-Warning "[BakeryOps] Server triggered, but port 3000 not active yet. Check logs at: $projectDir\logs\bakeryops.log"
}

