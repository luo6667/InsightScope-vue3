$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$local = Join-Path $root '.local'
$bin = Join-Path $local 'bin'
$logs = Join-Path $local 'logs'
$keyFile = Join-Path $local 'analysis.key'

New-Item -ItemType Directory -Path $bin, $logs -Force | Out-Null

$existing = @()
foreach ($role in @('api', 'worker', 'scheduler')) {
    $expected = Join-Path $bin "$role.exe"
    $existing += @(Get-Process -Name $role -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $expected })
}
if ($existing.Count -eq 3) {
    Write-Host 'Go backend is already running. Use .\stop.cmd to stop it.'
    exit 0
}
if ($existing.Count -gt 0) {
    throw 'Only part of the backend is running. Use .\stop.cmd, then retry.'
}

$savedKey = if (Test-Path -LiteralPath $keyFile) { [IO.File]::ReadAllText($keyFile).Trim() } else { '' }
$providedKey = $env:ANALYSIS_ENCRYPTION_KEY
if ($savedKey -and $providedKey -and $savedKey -ne $providedKey) {
    throw 'ANALYSIS_ENCRYPTION_KEY differs from .local/analysis.key. Keep the original key for unfinished jobs.'
}
$key = if ($providedKey) { $providedKey } else { $savedKey }
if (-not $key) {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $key = [Convert]::ToBase64String($bytes)
    [IO.File]::WriteAllText($keyFile, $key, [Text.Encoding]::ASCII)
    Write-Host 'Created a local encryption key in .local/analysis.key.'
}
try { $decoded = [Convert]::FromBase64String($key) } catch { throw 'ANALYSIS_ENCRYPTION_KEY is not valid Base64.' }
if ($decoded.Length -ne 32) { throw 'ANALYSIS_ENCRYPTION_KEY must decode to 32 bytes.' }
if (-not $savedKey -and $providedKey) {
    [IO.File]::WriteAllText($keyFile, $key, [Text.Encoding]::ASCII)
}
$env:ANALYSIS_ENCRYPTION_KEY = $key

$go = (Get-Command go -ErrorAction Stop).Source
$started = @()
Push-Location $root
try {
    foreach ($role in @('migrate', 'api', 'worker', 'scheduler')) {
        Write-Host "Building $role..."
        & $go build -o (Join-Path $bin "$role.exe") "./cmd/$role"
        if ($LASTEXITCODE -ne 0) { throw "Go build failed: $role" }
    }
    & (Join-Path $bin 'migrate.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }

    foreach ($role in @('api', 'worker', 'scheduler')) {
        $process = Start-Process -FilePath (Join-Path $bin "$role.exe") -WorkingDirectory $root `
            -RedirectStandardOutput (Join-Path $logs "$role.out.log") `
            -RedirectStandardError (Join-Path $logs "$role.err.log") `
            -WindowStyle Hidden -PassThru
        $started += [pscustomobject]@{ role = $role; pid = $process.Id; path = (Join-Path $bin "$role.exe") }
        Write-Host "Started $role (PID $($process.Id))."
    }

    $port = if ($env:PORT) { $env:PORT } else { '5176' }
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $apiProcess = Get-Process -Id $started[0].pid -ErrorAction SilentlyContinue
        if (-not $apiProcess) { break }
        try {
            $response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/readyz" -TimeoutSec 2
            if ($response.ok -and $response.db -eq 'up' -and $response.redis -eq 'up') { $ready = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    Start-Sleep -Seconds 1
    $stopped = @($started | Where-Object { -not (Get-Process -Id $_.pid -ErrorAction SilentlyContinue) })
    if (-not $ready -or $stopped.Count -gt 0) {
        $apiLog = Join-Path $logs 'api.err.log'
        if (Test-Path -LiteralPath $apiLog) { Get-Content -LiteralPath $apiLog -Tail 12 }
        throw 'Backend startup failed. See .local/logs/*.err.log.'
    }
    Write-Host "Go backend is ready at http://localhost:$port (API, Worker, Scheduler)."
} catch {
    foreach ($record in $started) {
        $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
        if ($process -and $process.Path -eq $record.path) { Stop-Process -Id $record.pid -Force }
    }
    throw
} finally {
    Pop-Location
}
