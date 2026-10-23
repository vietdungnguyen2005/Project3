param([switch]$Reconciliation)
$ErrorActionPreference = 'Stop'
$qaRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $qaRoot
if (Get-NetTCPConnection -State Listen -LocalPort 18083,13003 -ErrorAction SilentlyContinue) {
    throw 'QA ports 18083/13003 are already in use'
}
$qaOutput = Join-Path $qaRoot 'backend/target/operator-browser'
New-Item -ItemType Directory -Path $qaOutput -Force | Out-Null
$qaSuffix = [guid]::NewGuid().ToString('N').Substring(0,8)
$qaPostgres = "vpulse-auth-pg-$qaSuffix"
$qaRedis = "vpulse-auth-redis-$qaSuffix"
$qaBackend = $null
$qaFrontend = $null
$qaCrashRequest = $null

function Wait-QaHttp([string]$Url, [System.Diagnostics.Process]$Process) {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($watch.Elapsed.TotalSeconds -lt 60) {
        if ($Process.HasExited) { throw "QA server exited: $Url. Inspect $qaOutput" }
        try {
            if ((Invoke-WebRequest -Uri $Url -TimeoutSec 2).StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    throw "QA server did not become ready: $Url. Inspect $qaOutput"
}

try {
    docker run --rm -d --name $qaPostgres -e POSTGRES_DB=vpulse -e POSTGRES_USER=vpulse -e POSTGRES_PASSWORD=qa-local-password -p '127.0.0.1::5432' postgres:17.6-alpine
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL QA container failed' }
    docker run --rm -d --name $qaRedis -p '127.0.0.1::6379' redis:8.2-alpine
    if ($LASTEXITCODE -ne 0) { throw 'Redis QA container failed' }
    $qaPgPort = (docker port $qaPostgres 5432) -replace '^.*:', ''
    $qaRedisPort = (docker port $qaRedis 6379) -replace '^.*:', ''
    $env:SPRING_DATASOURCE_URL = "jdbc:postgresql://127.0.0.1:$qaPgPort/vpulse"
    $env:SPRING_DATASOURCE_USERNAME = 'vpulse'
    $env:SPRING_DATASOURCE_PASSWORD = 'qa-local-password'
    $env:SPRING_DATA_REDIS_URL = "redis://127.0.0.1:$qaRedisPort"
    $env:BFF_SHARED_SECRET = 'qa-bff-session-only'
    $env:VPULSE_OPS_SECRET = 'qa-ops-session-only'
    $env:VPULSE_DEMO_DATA_ENABLED = 'true'
    $env:AUTH_SECURE_COOKIE = 'false'
    $env:AUTH_BOOTSTRAP_USERNAME = 'qa-operator@example.test'
    $env:AUTH_BOOTSTRAP_PASSWORD_HASH = python -c "import bcrypt; print(bcrypt.hashpw(b'qa-session-password', bcrypt.gensalt()).decode())"
    if ($LASTEXITCODE -ne 0) { throw 'Python bcrypt is required' }
    $env:TEST_OPERATOR_USERNAME = 'qa-operator@example.test'
    $env:TEST_OPERATOR_PASSWORD = 'qa-session-password'
    $env:BACKEND_ORIGIN = 'http://127.0.0.1:18083'
    $env:BASE_URL = 'http://127.0.0.1:13003'
    $env:TEST_POSTGRES_CONTAINER = $qaPostgres
    $qaBackend = Start-Process -FilePath 'java' -ArgumentList '-jar','backend/target/v-pulse-backend-0.1.0-SNAPSHOT.jar','--server.port=18083' -WorkingDirectory $qaRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $qaOutput 'backend.log') -RedirectStandardError (Join-Path $qaOutput 'backend-error.log')
    Wait-QaHttp 'http://127.0.0.1:18083/actuator/health' $qaBackend
    $qaFrontend = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/c','npm run start -- --hostname 127.0.0.1 --port 13003' -WorkingDirectory $qaRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $qaOutput 'frontend.log') -RedirectStandardError (Join-Path $qaOutput 'frontend-error.log')
    Wait-QaHttp 'http://127.0.0.1:13003/' $qaFrontend
    python tools/qa_operator_session.py
    if ($LASTEXITCODE -ne 0) { throw 'Operator browser verification failed' }
    if ($Reconciliation) {
        python tools/qa_reconciliation.py scenarios
        if ($LASTEXITCODE -ne 0) { throw 'Reconciliation game-day A-D failed' }
        python tools/qa_reconciliation.py prepare-crash
        if ($LASTEXITCODE -ne 0) { throw 'Crash scenario preparation failed' }
        $qaCrashState = Get-Content -LiteralPath (Join-Path $qaOutput 'reconciliation-crash.json') -Raw | ConvertFrom-Json
        if ($qaCrashState.payment -notmatch '^VP-[A-Z0-9-]+$') { throw 'Invalid synthetic crash payment' }
        $qaCrashRequest = Start-Process -FilePath 'python' -ArgumentList 'tools/qa_reconciliation.py','crash-request' -WorkingDirectory $qaRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $qaOutput 'crash-request.log') -RedirectStandardError (Join-Path $qaOutput 'crash-request-error.log')
        $qaClaimSeen = $false
        $qaClaimWatch = [System.Diagnostics.Stopwatch]::StartNew()
        while ($qaClaimWatch.Elapsed.TotalSeconds -lt 15) {
            $qaClaimState = docker exec $qaPostgres psql -U vpulse -d vpulse -At -c "SELECT r.state FROM payment_reconciliation r JOIN payment_instruction p ON p.id=r.payment_id WHERE p.payment_number='$($qaCrashState.payment)' ORDER BY r.created_at DESC LIMIT 1"
            if ($qaClaimState -eq 'IN_PROGRESS') { $qaClaimSeen = $true; break }
            Start-Sleep -Milliseconds 50
        }
        if (-not $qaClaimSeen) { throw 'No durable IN_PROGRESS claim observed; refusing to claim a crash test' }
        taskkill /PID $qaBackend.Id /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Owned Java process was not terminated' }
        if (-not $qaCrashRequest.WaitForExit(20000)) { throw 'Crash request did not return' }
        if ($qaCrashRequest.ExitCode -ne 0) { throw 'Crash request did not observe upstream failure' }
        $qaBackend = Start-Process -FilePath 'java' -ArgumentList '-jar','backend/target/v-pulse-backend-0.1.0-SNAPSHOT.jar','--server.port=18083' -WorkingDirectory $qaRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $qaOutput 'backend-restart.log') -RedirectStandardError (Join-Path $qaOutput 'backend-restart-error.log')
        Wait-QaHttp 'http://127.0.0.1:18083/actuator/health' $qaBackend
        python tools/qa_reconciliation.py resume-crash
        if ($LASTEXITCODE -ne 0) { throw 'Crash restart reconciliation failed' }
    }
} finally {
    foreach ($qaProcess in @($qaFrontend, $qaBackend, $qaCrashRequest)) {
        if ($qaProcess -and -not $qaProcess.HasExited) {
            taskkill /PID $qaProcess.Id /T /F | Out-Null
        }
    }
    docker stop $qaPostgres $qaRedis
}
