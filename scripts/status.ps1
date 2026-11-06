$ErrorActionPreference = "SilentlyContinue"
$projectDir = "C:\Users\hadis\.switch\agents\localhost-57168\bakeryops-codex"
$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue

if ($conn) {
    $proc = Get-Process -Id ($conn | Select-Object -ExpandProperty OwningProcess -Unique) -ErrorAction SilentlyContinue
    Write-Host "[BakeryOps] Status: RUNNING (PID: $($proc.Id) - $($proc.ProcessName))"
    Write-Host "[BakeryOps] URL: http://localhost:3000"
} else {
    Write-Host "[BakeryOps] Status: STOPPED (Port 3000 is inactive)"
}

$logPath = Join-Path $projectDir "logs\bakeryops.log"
if (Test-Path $logPath) {
    Write-Host "`n--- Recent Log Lines ---"
    Get-Content $logPath -Tail 10
}

