$ErrorActionPreference = 'Stop'
$bin = Join-Path (Join-Path $PSScriptRoot '.local') 'bin'
$stopped = 0
foreach ($role in @('api', 'worker', 'scheduler')) {
    $expected = Join-Path $bin "$role.exe"
    $processes = @(Get-Process -Name $role -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $expected })
    foreach ($process in $processes) {
        Stop-Process -Id $process.Id -Force
        Write-Host "Stopped $role (PID $($process.Id))."
        $stopped++
    }
}
if ($stopped -eq 0) { Write-Host 'No managed Go backend processes were found.' }
