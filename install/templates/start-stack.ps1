# 自动生成：启动 Free Egg 全家桶（幂等，已监听的端口会跳过）
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$root = '{{ROOT}}'
$log = Join-Path $root 'logs'
if (-not (Test-Path $log)) { New-Item -ItemType Directory -Path $log -Force | Out-Null }

function Test-Port([int]$Port) {
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(800)) { return $false }
        $c.EndConnect($iar); return $true
    } catch { return $false } finally { $c.Close() }
}

function Save-Pid([string]$Name, $Process) {
    [System.IO.File]::WriteAllText((Join-Path $log ($Name + '.pid')), [string]$Process.Id, (New-Object System.Text.UTF8Encoding($false)))
}

if (-not (Test-Port {{WB_PORT}})) {
    try {
        $exe = Join-Path $root 'workbuddy\wb2api.exe'
        if (Test-Path $exe) {
            $p = Start-Process -FilePath $exe -ArgumentList '-config', 'config.json' -WorkingDirectory (Join-Path $root 'workbuddy') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $log 'workbuddy.out.log') -RedirectStandardError (Join-Path $log 'workbuddy.err.log') -PassThru
            Save-Pid 'workbuddy' $p
            Write-Host ('[OK] WorkBuddy 已启动（PID ' + $p.Id + '）')
        }
    } catch {
        Write-Host ('[!] WorkBuddy 启动失败：' + $_.Exception.Message)
    }
}

if (-not (Test-Port {{QODER_PORT}})) {
    try {
        $py = Join-Path $root 'qoder\python\python.exe'
        if (-not (Test-Path $py)) {
            $cmd = Get-Command python -ErrorAction SilentlyContinue
            if ($cmd) { $py = $cmd.Source }
        }
        $script = Join-Path $root 'qoder\qoder_proxy.py'
        if ((Test-Path $py) -and (Test-Path $script)) {
            $pw = ''
            $pwFile = Join-Path $root 'qoder\.panel-password'
            if (Test-Path $pwFile) { $pw = (Get-Content $pwFile -Raw).Trim() }
            $argLine = 'qoder_proxy.py --host 127.0.0.1 --port {{QODER_PORT}} --accounts-dir "' + (Join-Path $root 'qoder\accounts') + '" --usage-dir "' + (Join-Path $root 'qoder\usage') + '"'
            if ($pw) { $argLine = $argLine + ' --panel-password "' + $pw + '"' }
            $p = Start-Process -FilePath $py -ArgumentList $argLine -WorkingDirectory (Join-Path $root 'qoder') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $log 'qoder.out.log') -RedirectStandardError (Join-Path $log 'qoder.err.log') -PassThru
            Save-Pid 'qoder' $p
            Write-Host ('[OK] Qoder 已启动（PID ' + $p.Id + '）')
        }
    } catch {
        Write-Host ('[!] Qoder 启动失败：' + $_.Exception.Message)
    }
}

if (-not (Test-Port {{NEWAPI_PORT}})) {
    try {
        $exe = Join-Path $root 'newapi\new-api.exe'
        if (Test-Path $exe) {
            $old = $env:PORT
            $env:PORT = '{{NEWAPI_PORT}}'
            try {
                $p = Start-Process -FilePath $exe -WorkingDirectory (Join-Path $root 'newapi') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $log 'newapi.out.log') -RedirectStandardError (Join-Path $log 'newapi.err.log') -PassThru
                Save-Pid 'newapi' $p
                Write-Host ('[OK] New API 已启动（PID ' + $p.Id + '）')
            } finally {
                $env:PORT = $old
            }
        }
    } catch {
        Write-Host ('[!] New API 启动失败：' + $_.Exception.Message)
    }
}

Write-Host ''
Write-Host 'WorkBuddy : http://127.0.0.1:{{WB_PORT}}/panel/'
Write-Host 'Qoder     : http://127.0.0.1:{{QODER_PORT}}/'
Write-Host 'New API   : http://127.0.0.1:{{NEWAPI_PORT}}/'
