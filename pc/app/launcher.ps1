# Da Vinci Scanner for Windows.
# Runs with the PowerShell that ships with Windows 10/11; nothing to install.
#  - local web server on http://localhost:<port>/ (only this PC can reach it)
#  - app window (Edge/Chrome app mode), tray icon, background scanner (headless browser)
param([switch]$NoWindow)

$ErrorActionPreference = 'Stop'
$AppDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebDir  = Join-Path $AppDir 'web'
$DataDir = Join-Path $env:APPDATA 'DaVinciScanner'
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$LogFile = Join-Path $DataDir 'app.log'
function Log([string]$m) { try { Add-Content -Path $LogFile -Value ("{0:u}  {1}" -f (Get-Date), $m) } catch {} }

function Find-Browser {
  $c = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
  foreach ($p in $c) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}

$PortFile = Join-Path $DataDir 'port.txt'
function Open-AppWindow([int]$port) {
  $url = "http://localhost:$port/"
  $b = Find-Browser
  if ($b) {
    Start-Process -FilePath $b -ArgumentList @("--app=$url", "--user-data-dir=`"$DataDir\ui-profile`"", '--no-first-run', '--no-default-browser-check', '--window-size=1320,880')
  } else {
    Start-Process $url
  }
}

# ---------- single instance: a second start just opens the window ----------
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\DaVinciScannerApp', [ref]$created)
if (-not $created) {
  $p = 47011
  if (Test-Path $PortFile) { $p = [int](Get-Content $PortFile -Raw) }
  Open-AppWindow $p
  exit
}

# ---------- web server (runs on its own thread) ----------
$listener = $null
$Port = 0
foreach ($p in 47011..47030) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l; $Port = $p; break
  } catch { Log "port $p busy: $($_.Exception.Message)" }
}
if (-not $listener) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show('Da Vinci Scanner could not start its local server (ports 47011-47030 busy).', 'Da Vinci Scanner') | Out-Null
  exit 1
}
Set-Content -Path $PortFile -Value $Port
Log "server on port $Port"

$sync = [hashtable]::Synchronized(@{ Stop = $false; State = '{}'; DataDir = $DataDir; WebDir = $WebDir; AppDir = $AppDir })
$sync.Notes = [System.Collections.ArrayList]::Synchronized((New-Object System.Collections.ArrayList))
$stateFile = Join-Path $DataDir 'state.json'
if (Test-Path $stateFile) { $sync.State = [IO.File]::ReadAllText($stateFile) }

$ServerScript = [scriptblock]::Create([IO.File]::ReadAllText((Join-Path $AppDir 'server.ps1')))

$rs = [runspacefactory]::CreateRunspace()
$rs.Open()
$ps = [powershell]::Create()
$ps.Runspace = $rs
[void]$ps.AddScript($ServerScript).AddArgument($sync).AddArgument($listener)
$null = $ps.BeginInvoke()

# ---------- background scanner: a hidden headless browser runs worker.html ----------
function Stop-Worker {
  try {
    Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like '*DaVinciScanner*worker-profile*' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch {}
}
Stop-Worker
$browser = Find-Browser
if ($browser) {
  Start-Process -FilePath $browser -WindowStyle Hidden -ArgumentList @('--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
    "--user-data-dir=`"$DataDir\worker-profile`"", "http://localhost:$Port/worker.html")
  Log "worker started with $browser"
} else { Log 'no Edge/Chrome found: scanning only while the app window is open' }

# ---------- tray icon + alerts (main thread) ----------
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$tray = New-Object System.Windows.Forms.NotifyIcon
try { $tray.Icon = New-Object System.Drawing.Icon (Join-Path $AppDir 'icon.ico') } catch { $tray.Icon = [System.Drawing.SystemIcons]::Application }
$tray.Text = 'Da Vinci Scanner'
$tray.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miOpen = $menu.Items.Add('Open Da Vinci Scanner')
$miOpen.add_Click({ Open-AppWindow $Port })
$miExit = $menu.Items.Add('Exit (stop scanning)')
$miExit.add_Click({ $sync.Stop = $true; [System.Windows.Forms.Application]::Exit() })
$tray.ContextMenuStrip = $menu
$tray.add_DoubleClick({ Open-AppWindow $Port })
$tray.add_BalloonTipClicked({ Open-AppWindow $Port })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.add_Tick({
  while ($sync.Notes.Count -gt 0) {
    $n = $sync.Notes[0]; $sync.Notes.RemoveAt(0)
    $tray.ShowBalloonTip(15000, $n.title, $n.body, [System.Windows.Forms.ToolTipIcon]::Info)
    [System.Media.SystemSounds]::Exclamation.Play()
  }
  if ($sync.Stop) { [System.Windows.Forms.Application]::Exit() }
})
$timer.Start()

if (-not $NoWindow) { Open-AppWindow $Port }
$tray.ShowBalloonTip(4000, 'Da Vinci Scanner', 'Scanner is running. Right-click the tray icon to open or exit.', [System.Windows.Forms.ToolTipIcon]::Info)

[System.Windows.Forms.Application]::Run()

# ---------- shutdown ----------
$timer.Stop()
$tray.Visible = $false
$tray.Dispose()
$sync.Stop = $true
try { $listener.Stop(); $listener.Close() } catch {}
Stop-Worker
Log 'stopped'
$mutex.ReleaseMutex()
