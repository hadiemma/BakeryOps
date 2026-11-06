$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $scriptDir "stop.ps1")
Start-Sleep -Seconds 2
& (Join-Path $scriptDir "start.ps1")
