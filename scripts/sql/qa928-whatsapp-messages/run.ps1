# PostgreSQL temporal y local. No lee .env ni acepta URL remota.
param([string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('austral-qa928-messages-' + [Guid]::NewGuid().ToString('N'))
$dataPath = Join-Path $testRoot 'data'
$repoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$clusterStarted = $false
$probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$probe.Start(); $port = $probe.LocalEndpoint.Port; $probe.Stop()
function Invoke-PgTool([string]$Tool, [string[]]$Arguments) {
  if ($Tool -eq 'pg_ctl') {
    $quoted = $Arguments | ForEach-Object { '"' + $_.Replace('"','\"') + '"' }
    $process = Start-Process -FilePath (Join-Path $PgBin 'pg_ctl.exe') -ArgumentList $quoted -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'ctl-out.log') -RedirectStandardError (Join-Path $testRoot 'ctl-error.log')
    if (-not $process.WaitForExit(30000) -or $process.ExitCode -ne 0) { throw 'pg_ctl falló' }
    return
  }
  & (Join-Path $PgBin ($Tool + '.exe')) @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Tool falló ($LASTEXITCODE)" }
}
$sqlArgs = @('-X','-q','-w','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',"$port",'-U','postgres','-d','messages_test')
function SqlFile([string]$File) { Invoke-PgTool 'psql' ($sqlArgs + @('-f',$File)) }
function SqlText([string]$Sql) { Invoke-PgTool 'psql' ($sqlArgs + @('-c',$Sql)) }
function Start-Sql([string]$Sql, [string]$Name) {
  $allArgs = $sqlArgs + @('-A','-t','-c',$Sql)
  $quoted = $allArgs | ForEach-Object { '"' + $_.Replace('"','\"') + '"' }
  return Start-Process -FilePath (Join-Path $PgBin 'psql.exe') -ArgumentList $quoted -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot ($Name + '.out')) -RedirectStandardError (Join-Path $testRoot ($Name + '.err'))
}
try {
  New-Item -ItemType Directory -Path $testRoot | Out-Null
  Invoke-PgTool 'initdb' @('-D',$dataPath,'-U','postgres','-A','trust','-E','UTF8','--no-locale') | Out-Null
  $clusterStarted = $true
  Invoke-PgTool 'pg_ctl' @('-D',$dataPath,'-o',"-p $port -c listen_addresses=127.0.0.1",'-l',(Join-Path $testRoot 'postgres.log'),'-w','start')
  Invoke-PgTool 'createdb' @('-w','-h','127.0.0.1','-p',"$port",'-U','postgres','messages_test')
  SqlFile (Join-Path $PSScriptRoot 'fixture.sql')
  $migration = Join-Path $repoPath 'supabase/migrations/20261009121000_qa928_whatsapp_messages.sql'
  SqlFile $migration; SqlFile $migration
  SqlFile (Join-Path $PSScriptRoot 'tests.sql')
  # Mismo evento: A conserva abierta la transacción; B espera y obtiene replay.
  $call = "select public.registrar_mensaje_whatsapp_qa928(48,'inbound:concurrent','paciente','5491155552851','Concurrente','2026-10-09 15:00:00+00','concurrent')->>'status';"
  $a = Start-Sql ("set role service_role; begin; " + $call + ' select pg_sleep(2); commit;') 'same-a'
  Start-Sleep -Milliseconds 500
  $b = Start-Sql ("set role service_role; " + $call) 'same-b'
  foreach ($process in @($a,$b)) { if (-not $process.WaitForExit(30000) -or $process.ExitCode -ne 0) { throw 'Falló sesión concurrente' } }
  $aResult = (Get-Content (Join-Path $testRoot 'same-a.out') | Where-Object { $_ -match '^(persisted|replay)$' }) -join ''
  $bResult = (Get-Content (Join-Path $testRoot 'same-b.out') | Where-Object { $_ -match '^(persisted|replay)$' }) -join ''
  if ($aResult -ne 'persisted' -or $bResult -ne 'replay') { throw "FAIL concurrente: A=$aResult B=$bResult" }
  SqlText "select public.t_assert((select count(*)=1 from public.mensajes where qa_whatsapp_operation_id='inbound:concurrent'),'evento concurrente, una fila');"
  # Eventos distintos para un contacto nuevo simultáneo: una sola ficha.
  $processes = @()
  for ($i=1; $i -le 8; $i++) {
    $processes += Start-Sql "set role service_role; select public.registrar_mensaje_whatsapp_qa928(48,'inbound:burst-$i','paciente','5491155557777','Burst $i',now(),'burst-$i')->>'status';" "burst-$i"
  }
  foreach ($process in $processes) {
    if (-not $process.WaitForExit(30000) -or $process.ExitCode -ne 0) {
      Get-ChildItem -LiteralPath $testRoot -Filter 'burst-*.err' | ForEach-Object { Get-Content -LiteralPath $_.FullName }
      throw 'Falló ráfaga concurrente'
    }
  }
  SqlText "select public.t_assert((select count(*)=1 from public.clientes where telefono='5491155557777'),'burst: one customer'); select public.t_assert((select count(*)=8 from public.mensajes where telefono='5491155557777'),'burst: eight distinct events');"
  SqlFile (Join-Path $PSScriptRoot 'rollback.sql')
  SqlText "select public.t_assert(to_regprocedure('public.registrar_mensaje_whatsapp_qa928(bigint,text,text,text,text,timestamptz,text,text)') is null,'rollback removes RPC'); select public.t_assert((select count(*)=13 from public.mensajes),'rollback keeps messages'); select public.t_assert((select nombre='' from public.clientes where telefono='5491155552851'),'rollback leaves provisional name unknown');"
  SqlFile $migration
  SqlText "set role service_role; select public.t_assert(public.registrar_mensaje_whatsapp_qa928(48,'inbound:concurrent','paciente','5491155552851','Concurrente','2026-10-09 15:00:00+00','concurrent')->>'status'='replay','reaplicar conserva idempotencia');"
  Write-Output 'QA928 SQL LOCAL PASS: RPC, concurrencia, ficha única, permisos, rollback sin borrar filas y reaplicación'
} finally {
  if ($clusterStarted) { Invoke-PgTool 'pg_ctl' @('-D',$dataPath,'-m','fast','-w','stop') }
  $resolvedRoot = [IO.Path]::GetFullPath($testRoot)
  $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')
  if ((Split-Path $resolvedRoot -Parent) -ne $resolvedTemp -or (Split-Path $resolvedRoot -Leaf) -notmatch '^austral-qa928-messages-[0-9a-f]{32}$') { throw 'Ruta de limpieza inesperada' }
  if (Test-Path -LiteralPath $resolvedRoot) { Remove-Item -LiteralPath $resolvedRoot -Recurse -Force }
}
