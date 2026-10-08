param([ValidateRange(1, 65535)][int]$Port = 3001)
$ErrorActionPreference = 'Stop'
$allurRoot = Split-Path -Parent $PSScriptRoot

# Check the requested port before asking for a credential. Never stop another process.
$allurProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $allurProbe.Start() }
catch { throw "Port $Port is busy. Use another port: npm.cmd run start:openai -- -Port 3002" }
finally { $allurProbe.Stop() }

$allurPrevious = @{}
foreach ($name in @('OPENAI_API_KEY', 'OPENAI_MODEL', 'AI_PROVIDER', 'PORT')) {
    $allurPrevious[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$allurKey = $null
Push-Location -LiteralPath $allurRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $allurRoot 'dist/index.html'))) {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    }
    Write-Host 'Enter the OpenAI API key below. Input is hidden; no key is saved to disk.'
    $allurKey = Read-Host 'OpenAI API key' -AsSecureString
    $env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $allurKey).Password.Trim()
    if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) { throw 'No key entered. Nothing was sent.' }
    $allurKey.Dispose()
    $allurKey = $null
    $env:AI_PROVIDER = 'openai'
    $env:OPENAI_MODEL = 'gpt-4.1-mini'
    $env:PORT = [string]$Port
    Write-Host "Open http://127.0.0.1:$Port/#shift and click Explain. Stop with Ctrl+C."
    & node --env-file-if-exists=.env server/index.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Server stopped with an error' }
}
finally {
    if ($null -ne $allurKey) { $allurKey.Dispose() }
    foreach ($name in $allurPrevious.Keys) {
        [Environment]::SetEnvironmentVariable($name, $allurPrevious[$name], 'Process')
    }
    Pop-Location
}
