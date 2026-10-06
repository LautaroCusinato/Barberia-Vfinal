# Cluster PostgreSQL efímero local. Nunca lee .env ni acepta URL/credenciales.
# Uso: pwsh -File scripts/sql/catalogo-moneda/run.ps1
param([string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('austral-currency-' + [Guid]::NewGuid().ToString('N'))
$dataPath = Join-Path $testRoot 'data'
$logPath = Join-Path $testRoot 'postgres.log'
$clusterStarted = $false
$repoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portProbe.Start()
$port = $portProbe.LocalEndpoint.Port
$portProbe.Stop()
function Invoke-PgTool([string]$Tool, [string[]]$Arguments) {
  if ($Tool -eq 'pg_ctl') {
    # PowerShell puede esperar a los descendientes al invocar pg_ctl con &.
    # Esperar sólo al proceso padre permite que PostgreSQL siga en background.
    $quotedArgs = $Arguments | ForEach-Object { '"' + $_.Replace('"','\"') + '"' }
    $stdout = Join-Path $testRoot 'pg-ctl.stdout.log'
    $stderr = Join-Path $testRoot 'pg-ctl.stderr.log'
    $pgCtlProcess = Start-Process -FilePath (Join-Path $PgBin 'pg_ctl.exe') -ArgumentList $quotedArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    if (-not $pgCtlProcess.WaitForExit(30000)) { throw 'Timeout del proceso pg_ctl' }
    Get-Content -LiteralPath $stdout
    Get-Content -LiteralPath $stderr
    if ($pgCtlProcess.ExitCode -ne 0) { throw "pg_ctl falló ($($pgCtlProcess.ExitCode))" }
    return
  }
  & (Join-Path $PgBin ($Tool + '.exe')) @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Tool falló ($LASTEXITCODE)" }
}
function Invoke-SqlFile([string]$File) {
  Invoke-PgTool 'psql' @('-X','-q','-w','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',"$port",'-U','postgres','-d','currency_test','-f',$File)
}
try {
  foreach ($tool in @('initdb','pg_ctl','createdb','psql')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PgBin ($tool + '.exe')))) { throw "Falta $tool en PgBin" }
  }
  New-Item -ItemType Directory -Path $testRoot | Out-Null
  Invoke-PgTool 'initdb' @('-D',$dataPath,'-U','postgres','-A','trust','-E','UTF8','--no-locale')
  # Desde este punto un arranque fallido puede haber dejado un proceso vivo.
  # Intentar detenerlo en finally; si no se puede comprobar, conservar la carpeta.
  $clusterStarted = $true
  Invoke-PgTool 'pg_ctl' @('-D',$dataPath,'-o',"-p $port -c listen_addresses=127.0.0.1",'-l',$logPath,'-w','start')
  Invoke-PgTool 'createdb' @('-w','-h','127.0.0.1','-p',"$port",'-U','postgres','currency_test')
  Invoke-SqlFile (Join-Path $PSScriptRoot 'fixture.sql')
  Invoke-SqlFile (Join-Path $PSScriptRoot 'baseline.sql')
  Invoke-SqlFile (Join-Path $PSScriptRoot 'before.sql')
  $migration = Join-Path $repoPath 'supabase/migrations/20261005220000_public_booking_currency.sql'
  Invoke-SqlFile $migration
  Invoke-SqlFile $migration
  Invoke-SqlFile (Join-Path $PSScriptRoot 'tests.sql')
  Invoke-SqlFile (Join-Path $PSScriptRoot 'rollback.sql')
  Invoke-SqlFile (Join-Path $PSScriptRoot 'after-rollback.sql')
  Invoke-SqlFile (Join-Path $PSScriptRoot 'drift.sql')
  $driftOutput = & (Join-Path $PgBin 'psql.exe') '-X' '-q' '-w' '-v' 'ON_ERROR_STOP=1' '-h' '127.0.0.1' '-p' "$port" '-U' 'postgres' '-d' 'currency_test' '-f' $migration 2>&1
  if ($LASTEXITCODE -eq 0 -or ($driftOutput | Out-String) -notmatch 'Comparar drift') { throw 'FAIL: guard de drift no rechazó la definición ajena' }
  Write-Output 'PASS: guard de drift rechaza cambio no revisado'
  Invoke-SqlFile (Join-Path $PSScriptRoot 'after-drift.sql')
  Write-Output 'PASS: catálogo-moneda, migración repetida, rollback y permisos del fixture local'
} finally {
  if ($clusterStarted) { Invoke-PgTool 'pg_ctl' @('-D',$dataPath,'-m','fast','-w','stop') }
  # Verificación absoluta antes de eliminar sólo el directorio temporal propio.
  $resolvedRoot = [IO.Path]::GetFullPath($testRoot)
  $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')
  if ((Split-Path $resolvedRoot -Parent) -ne $resolvedTemp -or (Split-Path $resolvedRoot -Leaf) -notmatch '^austral-currency-[0-9a-f]{32}$') {
    throw 'Limpieza bloqueada: ruta temporal inesperada'
  }
  if (Test-Path -LiteralPath $resolvedRoot) { Remove-Item -LiteralPath $resolvedRoot -Recurse -Force }
}
