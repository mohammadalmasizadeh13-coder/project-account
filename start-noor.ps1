param([int]$Port = 5173, [switch]$RestartBackend)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$backendDir = Join-Path $projectRoot 'backend'
$frontendDir = Join-Path $projectRoot 'frontend'
$pythonExecutable = Join-Path $backendDir '.venv\Scripts\python.exe'
$viteEntry = Join-Path $frontendDir 'node_modules\vite\bin\vite.js'
$logsDir = Join-Path $projectRoot 'artifacts\runtime'
if (-not (Test-Path -LiteralPath $pythonExecutable)) { throw 'Backend environment is missing. Follow docs/NOOR_GOLD_GUIDE.fa.md.' }
if (-not (Test-Path -LiteralPath (Join-Path $backendDir '.env'))) { throw 'Backend .env is missing. Copy backend/.env.example to backend/.env; accounts are created at /register.' }
if (-not (Test-Path -LiteralPath $viteEntry)) { throw 'Frontend dependencies are missing. Run npm ci in frontend.' }
if ($Port -notin @(5173, 5174, 3000, 4173)) { throw 'Use port 5173, 5174, 3000 or 4173 and keep the same browser address for legacy data.' }
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
Push-Location $backendDir
try {
    $expectedRevision = & $pythonExecutable -m app.runtime
    if ($LASTEXITCODE -ne 0 -or $expectedRevision -notmatch '^[a-f0-9]{64}$') { throw 'Could not identify the current backend sources.' }
} finally { Pop-Location }
function Get-NoorBackend {
    try { return Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2 }
    catch { return $null }
}
function Test-NoorBackend {
    $health = Get-NoorBackend
    return $health.service -eq 'noor-gold-api' -and $health.sourceRevision -eq $expectedRevision
}
function Stop-ProjectBackend {
    # Only restart the listener owned by this checkout's virtual environment.
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue)
    if (-not $listeners.Count) { return }
    $processes = @(Get-CimInstance Win32_Process)
    $byId = @{}
    foreach ($process in $processes) { $byId[[int]$process.ProcessId] = $process }
    $roots = @{}
    foreach ($listener in $listeners) {
        $candidate = $byId[[int]$listener.OwningProcess]
        $seen = @{}
        $owned = $null
        while ($candidate -and -not $seen.ContainsKey([int]$candidate.ProcessId)) {
            $seen[[int]$candidate.ProcessId] = $true
            if ($candidate.ExecutablePath -eq $pythonExecutable -and
                $candidate.CommandLine -match '\buvicorn\s+app\.main:app\b' -and
                $candidate.CommandLine -match '--port\s+8000(?:\s|$)') { $owned = $candidate; break }
            $candidate = $byId[[int]$candidate.ParentProcessId]
        }
        if (-not $owned) { throw 'Port 8000 belongs to another process. Stop that server explicitly before starting this checkout.' }
        $roots[[int]$owned.ProcessId] = $true
    }
    foreach ($processId in $roots.Keys) {
        & taskkill.exe /PID $processId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not restart the project backend. No accounting files were changed.' }
    }
}
$runningBackend = Get-NoorBackend
if ($RestartBackend -or ($runningBackend -and -not (Test-NoorBackend))) {
    Write-Output 'Restarting the project backend to load the current sources...'
    Stop-ProjectBackend
}
if (-not (Test-NoorBackend)) {
    # Recover a stopped reloader as well, without starting a second port owner.
    Stop-ProjectBackend
    $backendProcess = Start-Process -FilePath $pythonExecutable -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000','--env-file','.env','--reload','--reload-dir','app') -WorkingDirectory $backendDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsDir 'backend.log') -RedirectStandardError (Join-Path $logsDir 'backend-error.log')
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        if (Test-NoorBackend) { break }
        if ($backendProcess.HasExited) { throw 'Backend failed to start. Read artifacts/runtime/backend-error.log.' }
        Start-Sleep -Milliseconds 250
    }
    if (-not (Test-NoorBackend)) { throw 'Backend did not become ready. Read artifacts/runtime/backend-error.log.' }
}
$frontendReady = $false
try { $health = Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 2; $frontendReady = $health.service -eq 'noor-gold-api' -and $health.sourceRevision -eq $expectedRevision } catch { }
if (-not $frontendReady) {
    $nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
    $frontendProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('node_modules/vite/bin/vite.js','--host','localhost','--port',"$Port",'--strictPort') -WorkingDirectory $frontendDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsDir "frontend-$Port.log") -RedirectStandardError (Join-Path $logsDir "frontend-$Port-error.log")
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
        try { $health = Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 2; $frontendReady = $health.service -eq 'noor-gold-api' -and $health.sourceRevision -eq $expectedRevision } catch { }
        if ($frontendReady) { break }
        if ($frontendProcess.HasExited) { throw "Frontend failed to start. Read artifacts/runtime/frontend-$Port-error.log." }
        Start-Sleep -Milliseconds 250
    }
    if (-not $frontendReady) { throw 'Frontend proxy did not become ready.' }
}
Write-Output "Zarnegar accounting is ready: http://localhost:$Port"
Write-Output "Create an account: http://localhost:$Port/register"
Write-Output "Sign in: http://localhost:$Port/login"
