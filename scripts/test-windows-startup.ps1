$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$path = (Resolve-Path (Join-Path $PSScriptRoot '../setup.ps1')).Path
$ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$fn = $ast.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-AppUrl'
}, $true)
if (-not $fn) { throw 'Get-AppUrl missing' }
. ([scriptblock]::Create($fn.Extent.Text))
$esc = [char]27
$cases = @(
  @{ Input = 'Local: http://localhost:5173/'; Expected = 'http://localhost:5173/' },
  @{ Input = "Local: http://localhost:$($esc)[1m5174$($esc)[22m/"; Expected = 'http://localhost:5174/' },
  @{ Input = "$($esc)[36mhttp://localhost:$($esc)[1m5180$($esc)[22m/$($esc)[39m"; Expected = 'http://localhost:5180/' },
  @{ Input = 'Port 5173 is in use, trying another one...'; Expected = $null },
  @{ Input = ''; Expected = $null }
)
foreach ($case in $cases) {
  $actual = Get-AppUrl $case.Input
  if ($actual -ne $case.Expected) { throw "Expected '$($case.Expected)', got '$actual'" }
}
Write-Host 'PASS: setup.ps1 parses and all 5 URL cases pass.'
