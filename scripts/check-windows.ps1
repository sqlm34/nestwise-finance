[CmdletBinding()]
param(
    [ValidateSet('all', 'typecheck', 'lint')]
    [string] $Check = 'all',
    [string] $NodePath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$requiredVersion = (Get-Content -LiteralPath (Join-Path $projectRoot '.nvmrc') -Raw).Trim()

# Never invoke npm/.bin CMD shims: their path expansion breaks on '&'.
if (-not $NodePath) {
    $bundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if (Test-Path -LiteralPath $bundledNode -PathType Leaf) {
        $NodePath = $bundledNode
    } else {
        $NodePath = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
    }
}
$NodePath = (Resolve-Path -LiteralPath $NodePath -ErrorAction Stop).Path
$actualVersion = & $NodePath --version
if ($LASTEXITCODE -ne 0 -or "$actualVersion" -ne "v$requiredVersion") {
    throw "Expected Node $requiredVersion from .nvmrc; got '$actualVersion'. Pass -NodePath with the matching node.exe."
}

$previousPath = $env:PATH
$exitCode = 0
Push-Location -LiteralPath $projectRoot
try {
    # Any child process that resolves 'node' must use this same runtime.
    $env:PATH = (Split-Path -Parent $NodePath) + [IO.Path]::PathSeparator + $previousPath
    Write-Host "Node $actualVersion ($NodePath)"
    Write-Host "Project: $projectRoot"
    $checks = if ($Check -eq 'all') { @('typecheck', 'lint') } else { @($Check) }
    foreach ($item in $checks) {
        if ($item -eq 'typecheck') {
            $entry = Join-Path $projectRoot 'node_modules/typescript/bin/tsc'
            $cliArgs = @('--noEmit')
        } else {
            $entry = Join-Path $projectRoot 'node_modules/eslint/bin/eslint.js'
            $cliArgs = @('src', 'tests', 'worker', 'scripts')
        }
        if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
            throw "Missing dependency entry point: $entry. Install project dependencies first."
        }
        Write-Host "Running $item"
        & $NodePath $entry @cliArgs
        if ($LASTEXITCODE -ne 0) {
            $exitCode = $LASTEXITCODE
            break
        }
        Write-Host "$item passed"
    }
} finally {
    $env:PATH = $previousPath
    Pop-Location
}
exit $exitCode
