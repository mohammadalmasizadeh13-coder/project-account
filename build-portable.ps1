param([switch]$IncludeCurrentData, [string]$OutputDirectory = 'Zarnegar-Portable')
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$pythonExecutable = Join-Path $projectRoot 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    throw 'Prepare backend/.venv with backend/requirements.txt first. See docs/PORTABLE_WINDOWS.fa.md.'
}
Push-Location $projectRoot
try {
    & $pythonExecutable -m pip install -r portable/requirements-build.txt
    if ($LASTEXITCODE -ne 0) { throw 'Installing the Windows packaging tools failed.' }
    if (-not (Test-Path -LiteralPath 'frontend/node_modules/vite/bin/vite.js')) {
        & npm.cmd ci --prefix frontend
        if ($LASTEXITCODE -ne 0) { throw 'Installing frontend build dependencies failed.' }
    }
    & npm.cmd run build --prefix frontend
    if ($LASTEXITCODE -ne 0) { throw 'Building the frontend failed.' }
    $buildArguments = @('portable/build.py', '--output', $OutputDirectory)
    if ($IncludeCurrentData) { $buildArguments += '--include-current-data' }
    & $pythonExecutable @buildArguments
    if ($LASTEXITCODE -ne 0) { throw 'Building the portable application failed.' }
} finally { Pop-Location }
