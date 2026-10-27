# 自动生成：查看 Free Egg 全家桶状态
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$root = '{{ROOT}}'
function Test-Port([int]$Port) {
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(800)) { return $false }
        $c.EndConnect($iar); return $true
    } catch { return $false } finally { $c.Close() }
}
$rows = @(
    @{ Name = 'WorkBuddy2API'; Port = {{WB_PORT}}; Url = 'http://127.0.0.1:{{WB_PORT}}/panel/' },
    @{ Name = 'Qoder2API-Hub'; Port = {{QODER_PORT}}; Url = 'http://127.0.0.1:{{QODER_PORT}}/' },
    @{ Name = 'New API'; Port = {{NEWAPI_PORT}}; Url = 'http://127.0.0.1:{{NEWAPI_PORT}}/' }
)
foreach ($row in $rows) {
    $up = Test-Port $row.Port
    $state = if ($up) { 'UP  ' } else { 'DOWN' }
    Write-Host ('[{0}] {1,-14} {2}' -f $state, $row.Name, $row.Url)
}
