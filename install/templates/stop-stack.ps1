# 自动生成：停止 Free Egg 全家桶（只停止本安装目录启动的进程）
$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$root = '{{ROOT}}'
$log = Join-Path $root 'logs'
foreach ($name in @('workbuddy', 'qoder', 'newapi')) {
    $pidFile = Join-Path $log ($name + '.pid')
    if (-not (Test-Path $pidFile)) { continue }
    $procId = 0
    [void][int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$procId)
    if ($procId -le 0) { continue }
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc) {
        $path = $null
        try { $path = $proc.Path } catch { }
        if ($path -and $path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
            Stop-Process -Id $procId -Force
            Write-Host ('[OK] 已停止 ' + $name + '（PID ' + $procId + '）')
        } else {
            Write-Host ('[!] ' + $name + ' 的 PID ' + $procId + ' 不属于本安装目录，跳过')
        }
    }
    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
}
