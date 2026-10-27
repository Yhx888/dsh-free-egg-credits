#Requires -Version 5.1
<#
.SYNOPSIS
    Free Egg 全家桶一键部署：WorkBuddy2API + Qoder2API-Hub + New API + DSH 插件配置。

.DESCRIPTION
    下载并配置三个本地服务，生成 start / stop / status 脚本与《使用指引》。
    默认安装到 %LOCALAPPDATA%\FreeEggStack，三个服务只监听 127.0.0.1：
      WorkBuddy2API  http://127.0.0.1:7863/panel/
      Qoder2API-Hub  http://127.0.0.1:8790/
      New API        http://127.0.0.1:3001/
    重复运行是幂等的：已有账号、数据库、密钥不会被覆盖。

.PARAMETER InstallRoot
    安装目录，默认 %LOCALAPPDATA%\FreeEggStack。
.PARAMETER WbPort
    WorkBuddy 网关端口，默认 7863。
.PARAMETER QoderPort
    Qoder 网关端口，默认 8790。
.PARAMETER NewApiPort
    New API 端口，默认 3001。
.PARAMETER Profile
    DSH profile 名（desktop / web），默认 desktop。
.PARAMETER SkipWorkBuddy
    不安装 WorkBuddy 网关。
.PARAMETER SkipQoder
    不安装 Qoder 网关。
.PARAMETER SkipNewApi
    不安装 New API。
.PARAMETER SkipPluginConfig
    不改 DSH 的 cordis.patch.yml，只生成 dsh-snippets.yml。
.PARAMETER NoStart
    只安装、不启动。
.PARAMETER AutoStart
    注册登录自启（HKCU Run），默认不注册。
.PARAMETER DryRun
    只打印安装计划，不下载、不写文件。
.PARAMETER Force
    覆盖已有组件文件与配置（不会删除账号数据、数据库、密钥）。
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\windows.ps1
.EXAMPLE
    .\windows.ps1 -InstallRoot D:\FreeEgg -Profile web -AutoStart
#>
[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FreeEggStack'),
    [int]$WbPort = 7863,
    [int]$QoderPort = 8790,
    [int]$NewApiPort = 3001,
    [string]$Profile = 'desktop',
    [switch]$SkipWorkBuddy,
    [switch]$SkipQoder,
    [switch]$SkipNewApi,
    [switch]$SkipPluginConfig,
    [switch]$NoStart,
    [switch]$AutoStart,
    [switch]$DryRun,
    [switch]$Force,
    [string]$WbVersion = 'v1.13.0',
    [string]$QoderVersion = 'v1.7.7',
    [string]$NewApiVersion = 'v1.0.0-rc.47',
    [string]$PythonVersion = '3.12.8'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$WbZipSha256 = '3e7a2bc9ea92246103de7777d59fe1f3351ada5bfa979f90dabf25bcc941eaa8'
$QoderZipSha256 = '565483db99e801c9dc819819ecbd351e3693f416c42e45f1361cec91ab39d850'
$NewApiExeSha256 = 'facf3714e560c83a5abee82094ee68de89ceb07a09b93b42a713e6fe7e37d76a'
$PythonZipSha256 = '8d3f33be9eb810f23c102f08475af2854e50484b8e4e06275e937be61ce3d2fb'

$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
if (-not $PSScriptRoot) { throw '请先下载仓库，再运行 install/windows.ps1（不要用 irm | iex）' }
$TemplateDir = Join-Path $PSScriptRoot 'templates'
$WbDir = Join-Path $InstallRoot 'workbuddy'
$QoderDir = Join-Path $InstallRoot 'qoder'
$NewApiDir = Join-Path $InstallRoot 'newapi'
$LogDir = Join-Path $InstallRoot 'logs'
$CacheDir = Join-Path $InstallRoot '.cache'
$script:StepTotal = 7

function Write-Step([int]$Index, [string]$Text) {
    Write-Host ''
    Write-Host ('[{0}/{1}] {2}' -f $Index, $script:StepTotal, $Text) -ForegroundColor Cyan
}
function Write-Ok([string]$Text) { Write-Host ('  [OK] ' + $Text) -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host ('       ' + $Text) -ForegroundColor Gray }
function Write-Warn([string]$Text) { Write-Host ('  [!] ' + $Text) -ForegroundColor Yellow }

function Test-Tcp([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(800)) { return $false }
        $client.EndConnect($iar)
        return $true
    } catch { return $false } finally { $client.Close() }
}

function New-Secret([int]$ByteCount = 18) {
    $bytes = New-Object byte[] $ByteCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function Write-TextFile([string]$Path, [string]$Text) {
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-Download([string]$Url, [string]$Dest, [string]$Label, [switch]$ForceDownload) {
    if ((Test-Path $Dest) -and -not $Force -and -not $ForceDownload) { Write-Ok ($Label + ' 已存在，跳过下载'); return }
    $dir = Split-Path -Parent $Dest
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Write-Info ('下载 ' + $Label + ' ...')
    $tmp = $Dest + '.part'
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            & $curl.Source -L --fail --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 30 --speed-limit 1024 --speed-time 60 -C - -o $tmp $Url
            if ($LASTEXITCODE -eq 0) { break }
            if ($LASTEXITCODE -eq 22 -or $LASTEXITCODE -eq 33) { if (Test-Path $tmp) { Remove-Item -Path $tmp -Force } }
            if ($attempt -eq 3) {
                if (Test-Path $tmp) { Remove-Item -Path $tmp -Force }
                throw ('下载失败（curl 退出码 ' + $LASTEXITCODE + '）：' + $Url)
            }
            Start-Sleep -Seconds 3
        }
    } else {
        Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing -TimeoutSec 1800
    }
    Move-Item -Path $tmp -Destination $Dest -Force
    Write-Ok ($Label + ' 下载完成')
}

function Assert-Hash([string]$Path, [string]$Expected, [string]$Label) {
    if (-not $Expected) { Write-Warn ($Label + ' 没有校验和，跳过校验'); return }
    $actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Expected.ToLowerInvariant()) { throw ($Label + ' 校验失败：' + $actual) }
    Write-Ok ($Label + ' 校验通过（SHA256）')
}

function Install-DownloadChecked([string]$Url, [string]$Dest, [string]$Label, [string]$Sha) {
    Invoke-Download $Url $Dest $Label
    try {
        Assert-Hash $Dest $Sha $Label
    } catch {
        Write-Warn ($Label + ' 校验失败，删除后重新下载...')
        Remove-Item -Path $Dest -Force -ErrorAction SilentlyContinue
        Invoke-Download $Url $Dest $Label -ForceDownload
        Assert-Hash $Dest $Sha $Label
    }
}

function Expand-Zip([string]$Zip, [string]$Dest) {
    if (-not (Test-Path $Dest)) { New-Item -ItemType Directory -Path $Dest -Force | Out-Null }
    Expand-Archive -Path $Zip -DestinationPath $Dest -Force
}

function Get-JsonFile([string]$Path) { return (Get-Content -Path $Path -Raw -Encoding UTF8 | ConvertFrom-Json) }

function Write-JsonFile([string]$Path, $Object) {
    Write-TextFile $Path ($Object | ConvertTo-Json -Depth 40)
}

function Write-ScriptFile([string]$Path, [string]$Text) {
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($true)))
}

function Render-Template([string]$Name, [hashtable]$Map) {
    $src = Join-Path $TemplateDir $Name
    if (-not (Test-Path $src)) { throw ('缺少模板：' + $src) }
    $text = Get-Content -LiteralPath $src -Raw -Encoding UTF8
    foreach ($key in $Map.Keys) { $text = $text.Replace([string]$key, [string]$Map[$key]) }
    $dest = Join-Path $InstallRoot $Name
    if ($Name -like '*.ps1') { Write-ScriptFile $dest $text } else { Write-TextFile $dest $text }
}

function Install-EmbeddedPython {
    $pyDir = Join-Path $QoderDir 'python'
    $pyExe = Join-Path $pyDir 'python.exe'
    if (-not (Test-Path $pyExe)) {
        $asset = 'python-' + $PythonVersion + '-embed-amd64.zip'
        $url = 'https://www.python.org/ftp/python/' + $PythonVersion + '/' + $asset
        $zip = Join-Path $CacheDir $asset
        Install-DownloadChecked $url $zip 'Python 嵌入式运行时' $PythonZipSha256
        Expand-Zip $zip $pyDir
    } else {
        Write-Ok '内置 Python 已存在，跳过下载'
    }
    $pth = Get-ChildItem -Path $pyDir -Filter 'python*._pth' | Select-Object -First 1
    if ($pth) {
        $zipName = (Get-ChildItem -Path $pyDir -Filter 'python*.zip' | Select-Object -First 1).Name
        $lines = @($zipName, '.', '..', 'import site')
        Write-TextFile $pth.FullName (($lines -join [Environment]::NewLine) + [Environment]::NewLine)
    }
    return $pyExe
}

function Copy-QoderSource {
    $zip = Join-Path $CacheDir ('qoder2api-hub-' + $QoderVersion + '.zip')
    $url = 'https://github.com/shuishuipingan/qoder2api-hub/archive/refs/tags/' + $QoderVersion + '.zip'
    Install-DownloadChecked $url $zip 'Qoder2API-Hub' $QoderZipSha256
    $extract = Join-Path $CacheDir ('qoder-src-' + $QoderVersion)
    Expand-Zip $zip $extract
    $inner = Get-ChildItem -Path $extract -Directory | Select-Object -First 1
    if (-not $inner) { throw 'Qoder 源码包结构异常' }
    if (-not (Test-Path $QoderDir)) { New-Item -ItemType Directory -Path $QoderDir -Force | Out-Null }
    foreach ($item in Get-ChildItem -Path $inner.FullName -Force) {
        if ($item.Name -in @('accounts', 'usage', '.gitignore')) { continue }
        $target = Join-Path $QoderDir $item.Name
        if ($item.PSIsContainer) {
            if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target -Force | Out-Null }
            Copy-Item -Path (Join-Path $item.FullName '*') -Destination $target -Recurse -Force
        } else {
            Copy-Item -Path $item.FullName -Destination $target -Force
        }
    }
    Write-Ok 'Qoder2API-Hub 已解压'
}

function Test-PluginInstalled([string]$ProfileDir) {
    $pkg = Join-Path $ProfileDir 'package.json'
    if (Test-Path $pkg) {
        if ((Get-Content $pkg -Raw -Encoding UTF8) -match 'dsh-free-egg-credits') { return $true }
    }
    return (Test-Path (Join-Path $ProfileDir 'node_modules\dsh-free-egg-credits'))
}

function Install-DshPluginConfig {
    if ($SkipPluginConfig) { return }
    $userProfile = $env:USERPROFILE
    if (-not $userProfile) { $userProfile = [Environment]::GetFolderPath('UserProfile') }
    $profileDir = Join-Path $userProfile ('.dsh\profiles\' + $Profile)
    if (-not (Test-Path $profileDir)) { Write-Warn ('未找到 DSH profile：' + $profileDir); return }
    if (-not (Test-PluginInstalled $profileDir)) {
        Write-Warn 'DSH 插件还没装：先安装插件，再把 dsh-snippets.yml 里的插件段追加到 cordis.patch.yml'
        return
    }
    $patch = Join-Path $profileDir 'cordis.patch.yml'
    $content = ''
    if (Test-Path $patch) { $content = Get-Content -Path $patch -Raw -Encoding UTF8 }
    if ($content -match '(?m)^\s*-\s*id:\s*free-egg-credits\s*$') { Write-Ok 'DSH 插件配置已存在'; return }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    if (Test-Path $patch) { Copy-Item -Path $patch -Destination ($patch + '.bak-freeegg-' + $stamp) -Force }
    $rootYaml = $InstallRoot.Replace('\', '/')
    $block = @"
# Free Egg Credits（由 Free Egg 一键部署写入）
- id: free-egg-credits
  config:
    gatewayBaseUrl: 'http://127.0.0.1:$WbPort'
    gatewayConfigPath: '$rootYaml/workbuddy/config.json'
    qoder:
      baseUrl: 'http://127.0.0.1:$QoderPort'
      panelPasswordFile: '$rootYaml/qoder/.panel-password'
"@
    Write-TextFile $patch (($content.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + $block + [Environment]::NewLine))
    Write-Ok ('已写入 DSH 插件配置（备份 .bak-freeegg-' + $stamp + '）')
}

Write-Host ''
Write-Host '  Free Egg 全家桶 · 一键部署' -ForegroundColor Cyan
Write-Host '  WorkBuddy2API + Qoder2API-Hub + New API + DSH 插件' -ForegroundColor DarkGray
Write-Host ''

if ($DryRun) {
    Write-Host '  [DryRun] 只打印计划，不下载、不写文件。' -ForegroundColor Yellow
    Write-Host ('  安装目录：' + $InstallRoot)
    Write-Host ('  端口：' + $WbPort + ' / ' + $QoderPort + ' / ' + $NewApiPort)
    Write-Host ('  DSH profile：' + $Profile)
    return
}

Write-Step 1 '环境检查'
if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) { throw '本安装器仅支持 Windows。' }
Write-Ok ('PowerShell ' + $PSVersionTable.PSVersion.ToString())
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { Write-Warn '未找到 curl.exe，将回退到 Invoke-WebRequest（可能较慢）' }
if ($InstallRoot -match '^[A-Za-z]:\\') {
    $freeGB = $null
    try { $freeGB = [Math]::Round(((Get-PSDrive -Name $InstallRoot.Substring(0, 1)).Free / 1GB), 1) } catch { }
    if ($null -ne $freeGB) {
        Write-Ok ('磁盘剩余 ' + $freeGB + ' GB')
        if ($freeGB -lt 1.5) { throw '磁盘空间不足（建议至少 1.5 GB）' }
    } else {
        Write-Warn '无法读取磁盘剩余空间，跳过检查'
    }
}
Write-Ok ('安装目录：' + $InstallRoot)

Write-Step 2 '准备目录'
foreach ($dir in @($InstallRoot, $WbDir, $QoderDir, $NewApiDir, $LogDir, $CacheDir)) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}
Write-Ok '目录就绪'

Write-Step 3 '下载组件'
if (-not $SkipWorkBuddy) {
    $asset = 'wb2api-panel-' + $WbVersion + '-windows-amd64.zip'
    $url = 'https://github.com/linguo2625469/workbuddy2api-panel/releases/download/' + $WbVersion + '/' + $asset
    $zip = Join-Path $CacheDir $asset
    Install-DownloadChecked $url $zip 'WorkBuddy2API' $WbZipSha256
    if ((Test-Tcp $WbPort) -and (Test-Path (Join-Path $WbDir 'wb2api.exe'))) {
        Write-Ok 'WorkBuddy 正在运行，保留现有文件（升级请先 stop-stack.ps1）'
    } else {
        Expand-Zip $zip $WbDir
        Write-Ok 'WorkBuddy2API 已解压'
    }
}
if (-not $SkipQoder) { Copy-QoderSource; [void](Install-EmbeddedPython); Write-Ok 'Qoder 内置 Python 就绪' }
if (-not $SkipNewApi) {
    $asset = 'new-api-' + $NewApiVersion + '.exe'
    $url = 'https://github.com/QuantumNous/new-api/releases/download/' + $NewApiVersion + '/' + $asset
    $exe = Join-Path $CacheDir $asset
    Install-DownloadChecked $url $exe 'New API' $NewApiExeSha256
    $target = Join-Path $NewApiDir 'new-api.exe'
    if ((Test-Tcp $NewApiPort) -and (Test-Path $target)) {
        Write-Ok 'New API 正在运行，保留现有文件（升级请先 stop-stack.ps1）'
    } else {
        Copy-Item -Path $exe -Destination $target -Force
        Write-Ok 'New API 已就位'
    }
}

Write-Step 4 '写入配置'
if (-not $SkipWorkBuddy) {
    $cfgPath = Join-Path $WbDir 'config.json'
    if (-not (Test-Path $cfgPath)) {
        $cfg = Get-JsonFile (Join-Path $WbDir 'config.example.json')
        $cfg.listen = ':' + $WbPort
        if ((-not $cfg.api_key) -or ($cfg.api_key -eq 'test_key')) { $cfg.api_key = 'sk-freeegg-' + (New-Secret 20) }
        $cfg.auth_dir = (Join-Path $WbDir 'auths')
        $cfg.state_file = (Join-Path $WbDir 'data\state.json')
        if ($cfg.pool -and ($cfg.pool.PSObject.Properties.Name -contains 'prefer_credits')) { $cfg.pool.prefer_credits = $true }
        Write-JsonFile $cfgPath $cfg
        Write-Ok '已生成 workbuddy/config.json'
    } else {
        Write-Ok 'workbuddy/config.json 已存在，保留原配置'
    }
    foreach ($d in @((Join-Path $WbDir 'auths'), (Join-Path $WbDir 'data'))) {
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    }
}
if (-not $SkipQoder) {
    $pwFile = Join-Path $QoderDir '.panel-password'
    if (-not (Test-Path $pwFile)) { Write-TextFile $pwFile ((New-Secret 12) + [Environment]::NewLine); Write-Ok '已生成 Qoder 看板密码' }
    else { Write-Ok 'Qoder 看板密码已存在，保留原密码' }
    foreach ($d in @((Join-Path $QoderDir 'accounts'), (Join-Path $QoderDir 'usage'))) {
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    }
}

Write-Step 5 '生成运维脚本与使用指引'
$rootPs = $InstallRoot.Replace("'", "''")
$rootYaml = $InstallRoot.Replace('\', '/')
$common = @{
    '{{ROOT}}' = $rootPs
    '{{WB_PORT}}' = [string]$WbPort
    '{{QODER_PORT}}' = [string]$QoderPort
    '{{NEWAPI_PORT}}' = [string]$NewApiPort
}
Render-Template 'start-stack.ps1' $common
Render-Template 'stop-stack.ps1' $common
Render-Template 'status.ps1' $common
Write-Ok 'start-stack.ps1 / stop-stack.ps1 / status.ps1 已生成'

$WbKey = ''
if (Test-Path (Join-Path $WbDir 'config.json')) { try { $WbKey = [string](Get-JsonFile (Join-Path $WbDir 'config.json')).api_key } catch { } }
$QoderPw = ''
if (Test-Path (Join-Path $QoderDir '.panel-password')) { $QoderPw = (Get-Content (Join-Path $QoderDir '.panel-password') -Raw).Trim() }

$docMap = @{
    '{{ROOT}}' = $rootPs
    '{{WB_PORT}}' = [string]$WbPort
    '{{QODER_PORT}}' = [string]$QoderPort
    '{{NEWAPI_PORT}}' = [string]$NewApiPort
    '{{WB_KEY}}' = $WbKey
    '{{QODER_PW}}' = $QoderPw
}
Render-Template '使用指引.md' $docMap
$snipMap = @{
    '{{ROOT}}' = $rootYaml
    '{{WB_PORT}}' = [string]$WbPort
    '{{QODER_PORT}}' = [string]$QoderPort
    '{{NEWAPI_PORT}}' = [string]$NewApiPort
}
Render-Template 'dsh-snippets.yml' $snipMap
Write-Ok '使用指引.md / dsh-snippets.yml 已生成'

Install-DshPluginConfig

Write-Step 6 '启动服务'
if ($NoStart) {
    Write-Info '已跳过启动（-NoStart）'
} else {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallRoot 'start-stack.ps1')
    Start-Sleep -Seconds 3
    foreach ($c in @(
        @{ Name = 'WorkBuddy'; Port = $WbPort },
        @{ Name = 'Qoder'; Port = $QoderPort },
        @{ Name = 'New API'; Port = $NewApiPort }
    )) {
        if (Test-Tcp $c.Port) { Write-Ok ($c.Name + ' 已监听 127.0.0.1:' + $c.Port) }
        else { Write-Warn ($c.Name + ' 暂未监听，查看 logs 目录') }
    }
}

if ($AutoStart) {
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    if (-not (Test-Path $runKey)) { New-Item -Path $runKey -Force | Out-Null }
    $cmd = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $InstallRoot 'start-stack.ps1') + '"'
    Set-ItemProperty -Path $runKey -Name 'FreeEggStack' -Value $cmd
    Write-Ok '已注册登录自启（HKCU Run: FreeEggStack）'
}

Write-Step 7 '完成'
Write-Host ''
Write-Host '  下一步（约 10 分钟）：' -ForegroundColor White
if (-not $SkipWorkBuddy) {
    Write-Host ('   1) WorkBuddy 面板  http://127.0.0.1:' + $WbPort + '/panel/') -ForegroundColor Cyan
    if ($WbKey) { Write-Host ('      密钥：' + $WbKey) -ForegroundColor Gray }
}
if (-not $SkipQoder) {
    Write-Host ('   2) Qoder 看板     http://127.0.0.1:' + $QoderPort + '/') -ForegroundColor Cyan
    if ($QoderPw) { Write-Host ('      密码：' + $QoderPw) -ForegroundColor Gray }
}
if (-not $SkipNewApi) { Write-Host ('   3) New API        http://127.0.0.1:' + $NewApiPort + '/') -ForegroundColor Cyan }
Write-Host ''
Write-Host ('   完整步骤：' + (Join-Path $InstallRoot '使用指引.md')) -ForegroundColor White
Write-Host ('   DSH 片段：' + (Join-Path $InstallRoot 'dsh-snippets.yml')) -ForegroundColor White
Write-Host ''
Write-Host '  提示：三个服务只监听本机，不要把端口暴露到公网。' -ForegroundColor DarkGray
Write-Host ''
