# Creates the Desktop and Start Menu shortcuts for Da Vinci Scanner, then starts it.
$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $AppDir
$Vbs = Join-Path $Root 'Da Vinci Scanner.vbs'
$Icon = Join-Path $AppDir 'icon.ico'

# files copied from the internet can be blocked by Windows; unblock ours
Get-ChildItem -Path $Root -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Da Vinci Scanner.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Da Vinci Scanner.lnk')
)
foreach ($lnk in $targets) {
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $s.Arguments = '"' + $Vbs + '"'
  $s.WorkingDirectory = $Root
  $s.IconLocation = $Icon
  $s.Description = 'Da Vinci setup scanner'
  $s.Save()
}
Write-Host ''
Write-Host '  Da Vinci Scanner installed.' -ForegroundColor Green
Write-Host '  Desktop aur Start Menu par "Da Vinci Scanner" icon ban gaya.'
Write-Host '  App ab khul rahi hai...'
Write-Host ''
Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('"' + $Vbs + '"')
Start-Sleep -Seconds 3
