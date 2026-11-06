$ErrorActionPreference = "SilentlyContinue"
$taskName = "BakeryOpsServer"
$currentPid = $PID

Write-Host "[BakeryOps] Stopping server..."

# Stop scheduled task
schtasks.exe /End /TN $taskName 2>$null | Out-Null

# Kill any processes listening on port 3000
$pids = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($p in $pids) {
    if ($p -and $p -ne $currentPid) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    }
}

# Kill any related node/bun processes tied to bakeryops-codex (excluding this PowerShell process)
$bakeryProcesses = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%bakeryops-codex%'" -ErrorAction SilentlyContinue
foreach ($bp in $bakeryProcesses) {
    if ($bp.ProcessId -ne $currentPid -and $bp.Name -ne "powershell.exe" -and $bp.Name -ne "pwsh.exe") {
        Stop-Process -Id $bp.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

Start-Sleep -Seconds 1
$remaining = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if (-not $remaining) {
    Write-Host "[BakeryOps] Server stopped successfully. Port 3000 is free."
} else {
    Write-Warning "[BakeryOps] Some connections still lingering on port 3000."
}
