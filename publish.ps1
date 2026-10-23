# 使用 Git Bash 执行增量部署；无参数默认前端，其他参数原样传给 deploy.sh。
$ErrorActionPreference = 'Stop'
$gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
$bashCandidates = @(
    (Join-Path $env:ProgramFiles 'Git\bin\bash.exe')
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe')
)
if ($gitCommand) {
    $gitRoot = Split-Path (Split-Path $gitCommand.Source -Parent) -Parent
    $bashCandidates += Join-Path $gitRoot 'bin\bash.exe'
}
$gitBash = $bashCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $gitBash) {
    throw '未找到 Git Bash。请安装 Git for Windows 后再发布。'
}

Push-Location -LiteralPath $PSScriptRoot
try {
    & $gitBash --noprofile --norc ./deploy.sh @args
    $deploymentExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($deploymentExitCode -ne 0) {
    Write-Error "部署失败，退出码：$deploymentExitCode" -ErrorAction Continue
    exit $deploymentExitCode
}
