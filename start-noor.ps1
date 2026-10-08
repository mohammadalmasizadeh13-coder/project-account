param([int]$Port = 5173)
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
function Test-NoorBackend {
    try { return (Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2).service -eq 'noor-gold-api' }
    catch { return $false }
}
if (-not (Test-NoorBackend)) {
    $backendProcess = Start-Process -FilePath $pythonExecutable -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000','--env-file','.env','--reload','--reload-dir','app') -WorkingDirectory $backendDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsDir 'backend.log') -RedirectStandardError (Join-Path $logsDir 'backend-error.log')
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
        if (Test-NoorBackend) { break }
        if ($backendProcess.HasExited) { throw 'Backend failed to start. Read artifacts/runtime/backend-error.log.' }
        Start-Sleep -Milliseconds 250
    }
    if (-not (Test-NoorBackend)) { throw 'Backend did not become ready. Read artifacts/runtime/backend-error.log.' }
}
$frontendReady = $false
try { $frontendReady = (Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 2).service -eq 'noor-gold-api' } catch { }
if (-not $frontendReady) {
    $nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
    $frontendProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('node_modules/vite/bin/vite.js','--host','localhost','--port',"$Port",'--strictPort') -WorkingDirectory $frontendDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsDir "frontend-$Port.log") -RedirectStandardError (Join-Path $logsDir "frontend-$Port-error.log")
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
        try { $frontendReady = (Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 2).service -eq 'noor-gold-api' } catch { }
        if ($frontendReady) { break }
        if ($frontendProcess.HasExited) { throw "Frontend failed to start. Read artifacts/runtime/frontend-$Port-error.log." }
        Start-Sleep -Milliseconds 250
    }
    if (-not $frontendReady) { throw 'Frontend proxy did not become ready.' }
}
Write-Output "Zarnegar accounting is ready: http://localhost:$Port"
Write-Output "Create an account: http://localhost:$Port/register"
Write-Output "Sign in: http://localhost:$Port/login"
