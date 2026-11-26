# Create desktop + Start Menu shortcuts for the Fanqie Novel app.
# ASCII only: PowerShell 5.1 may read BOM-less files as ANSI.
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $here 'server.mjs'
if (-not (Test-Path $server)) { throw "server.mjs not found in $here" }

# Pick a node.exe that belongs to the USER, not to the WorkBuddy runtime.
# Order matters: user-managed installs first, bundled copy last.
$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'Author Software\nvm\.nodejs\node.exe'),   # nvm-windows symlink
  (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
  (Join-Path $here 'node.exe')                                           # bundled fallback
)
$node = $null
foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { $node = $c; break } }
if (-not $node) {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { $node = $cmd.Source }
}
if (-not $node) { throw 'node.exe not found. Install Node.js 18+ first.' }

$icon = Join-Path $here 'icon.ico'
$name = (-join [char[]]@(0x756A,0x8304,0x5C0F,0x8BF4))   # Fanqie Novel

$shell = New-Object -ComObject WScript.Shell

function New-AppShortcut([string]$linkPath) {
  $sc = $shell.CreateShortcut($linkPath)
  $sc.TargetPath       = $node
  $sc.Arguments        = '"' + $server + '"'
  $sc.WorkingDirectory = $here
  $sc.Description      = 'Fanqie Novel - local bookshelf reader'
  $sc.WindowStyle      = 7      # minimized: keeps the console hidden
  if (Test-Path $icon) { $sc.IconLocation = $icon + ',0' }
  $sc.Save()
  return $linkPath
}

$targets = @()
$desktop = [Environment]::GetFolderPath('Desktop')
if ($desktop -and (Test-Path $desktop)) { $targets += New-AppShortcut (Join-Path $desktop "$name.lnk") }
$startMenu = [Environment]::GetFolderPath('Programs')
if ($startMenu -and (Test-Path $startMenu)) { $targets += New-AppShortcut (Join-Path $startMenu "$name.lnk") }

$out = @()
$out += 'NODE ' + $node
foreach ($t in $targets) { $out += 'OK   ' + $t }
$out | Out-File -FilePath (Join-Path $here 'shortcut-result.txt') -Encoding UTF8
Write-Output 'done'