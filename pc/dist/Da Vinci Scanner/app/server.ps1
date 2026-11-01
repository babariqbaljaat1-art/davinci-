# Local web server for Da Vinci Scanner (loaded by launcher.ps1 into its own runspace).
  param($sync, $listener)
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $WebDir = [IO.Path]::GetFullPath($sync.WebDir)
  $DataDir = $sync.DataDir
  $mime = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8';
             '.png' = 'image/png'; '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json'; '.ico' = 'image/x-icon'; '.svg' = 'image/svg+xml' }
  $cache = @{}

  function Send($ctx, [int]$code, [string]$type, [byte[]]$bytes) {
    $r = $ctx.Response
    $r.StatusCode = $code
    $r.ContentType = $type
    $r.Headers['Cache-Control'] = 'no-store'
    $r.ContentLength64 = $bytes.Length
    $r.OutputStream.Write($bytes, 0, $bytes.Length)
    $r.OutputStream.Close()
  }
  function SendText($ctx, [int]$code, [string]$type, [string]$text) { Send $ctx $code $type ([Text.Encoding]::UTF8.GetBytes($text)) }
  function ReadBody($ctx) {
    $sr = New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)
    $t = $sr.ReadToEnd(); $sr.Close(); return $t
  }
  function New-Client {
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DaVinciScanner/1.0')
    $wc.Encoding = [Text.Encoding]::UTF8
    return $wc
  }
  function Get-Config {
    $f = Join-Path $DataDir 'config.json'
    if (Test-Path $f) { try { return ([IO.File]::ReadAllText($f) | ConvertFrom-Json) } catch {} }
    return $null
  }
  function Set-AutoStart([bool]$on) {
    $lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Da Vinci Scanner.lnk'
    if ($on) {
      $sh = New-Object -ComObject WScript.Shell
      $s = $sh.CreateShortcut($lnk)
      $s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
      $s.Arguments = '"' + (Join-Path (Split-Path $sync.AppDir -Parent) 'Da Vinci Scanner.vbs') + '" /tray'
      $s.IconLocation = (Join-Path $sync.AppDir 'icon.ico')
      $s.WorkingDirectory = (Split-Path $sync.AppDir -Parent)
      $s.Save()
    } elseif (Test-Path $lnk) { Remove-Item $lnk -Force }
  }

  while (-not $sync.Stop -and $listener.IsListening) {
    try { $ctx = $listener.GetContext() } catch { break }
    try {
      $req = $ctx.Request
      $path = $req.Url.AbsolutePath
      $q = $req.QueryString

      if ($path -eq '/api/candles') {
        $sym = [string]$q['symbol']; $iv = [string]$q['interval']; $rg = [string]$q['range']
        if ($sym -notmatch '^[A-Za-z0-9=\^\.\-]{1,20}$' -or $iv -notmatch '^\d{1,2}[mhd]$' -or $rg -notmatch '^\d{1,3}[dmy]$') { SendText $ctx 400 'text/plain' 'bad request'; continue }
        $key = "$sym|$iv|$rg"; $now = [DateTime]::UtcNow
        $hit = $cache[$key]
        if ($hit -and ($now - $hit.at).TotalSeconds -lt 25) { SendText $ctx 200 'application/json' $hit.body; continue }
        $u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + [Uri]::EscapeDataString($sym) + "?interval=$iv&range=$rg&includePrePost=false"
        try { $body = (New-Client).DownloadString($u) }
        catch { $u = $u.Replace('query1.', 'query2.'); $body = (New-Client).DownloadString($u) }
        $cache[$key] = @{ at = $now; body = $body }
        SendText $ctx 200 'application/json' $body
        continue
      }
      if ($path -eq '/api/news') {
        # this week's economic calendar (red-folder news) for the Inter Equity time rules; cached 1 hour
        $now = [DateTime]::UtcNow; $hit = $cache['news']
        if ($hit -and ($now - $hit.at).TotalMinutes -lt 60) { SendText $ctx 200 'application/json' $hit.body; continue }
        $body = '[]'
        try { $body = (New-Client).DownloadString('https://nfs.faireconomy.media/ff_calendar_thisweek.json') } catch { if ($hit) { $body = $hit.body } }
        $cache['news'] = @{ at = $now; body = $body }
        SendText $ctx 200 'application/json' $body
        continue
      }
      if ($path -eq '/api/config') {
        $f = Join-Path $DataDir 'config.json'
        if ($req.HttpMethod -eq 'POST') {
          $t = ReadBody $ctx
          $null = $t | ConvertFrom-Json   # validate
          [IO.File]::WriteAllText($f, $t, (New-Object Text.UTF8Encoding($false)))
          try { $c = $t | ConvertFrom-Json; Set-AutoStart ([bool]$c.autoStart) } catch {}
          SendText $ctx 200 'application/json' '{"ok":true}'
        } else {
          $t = '{}'; if (Test-Path $f) { $t = [IO.File]::ReadAllText($f) }
          SendText $ctx 200 'application/json' $t
        }
        continue
      }
      if ($path -eq '/api/state') {
        if ($req.HttpMethod -eq 'POST') {
          $sync.State = ReadBody $ctx
          [IO.File]::WriteAllText((Join-Path $DataDir 'state.json'), $sync.State, (New-Object Text.UTF8Encoding($false)))
          SendText $ctx 200 'application/json' '{"ok":true}'
        } else { SendText $ctx 200 'application/json' $sync.State }
        continue
      }
      if ($path -eq '/api/alert' -and $req.HttpMethod -eq 'POST') {
        $a = (ReadBody $ctx) | ConvertFrom-Json
        if ($a.notify -ne $false) { [void]$sync.Notes.Add(@{ title = [string]$a.title; body = [string]$a.body }) }
        $res = 'off'
        $cfg = Get-Config
        if ($a.telegram -and $cfg -and $cfg.telegram -and $cfg.telegram.token -and $cfg.telegram.chat) {
          $payload = @{ chat_id = [string]$cfg.telegram.chat; text = [string]$a.text; parse_mode = 'HTML'; disable_web_page_preview = $true } | ConvertTo-Json -Compress
          try {
            $wc = New-Client; $wc.Headers.Add('Content-Type', 'application/json')
            [void]$wc.UploadString('https://api.telegram.org/bot' + $cfg.telegram.token + '/sendMessage', 'POST', $payload)
            $res = 'sent'
          } catch { $res = 'error: ' + $_.Exception.Message }
        }
        SendText $ctx 200 'application/json' ((@{ ok = $true; telegram = $res }) | ConvertTo-Json -Compress)
        continue
      }
      if ($path -eq '/api/ping') { SendText $ctx 200 'application/json' '{"ok":true,"app":"davinci-scanner"}'; continue }
      if ($path -eq '/api/quit' -and $req.HttpMethod -eq 'POST') { $sync.Stop = $true; SendText $ctx 200 'application/json' '{"ok":true}'; break }

      # static files from web/
      $rel = $path.TrimStart('/'); if ($rel -eq '') { $rel = 'index.html' }
      $full = [IO.Path]::GetFullPath((Join-Path $WebDir $rel))
      if (-not $full.StartsWith($WebDir, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        SendText $ctx 404 'text/plain' 'not found'; continue
      }
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $type = 'application/octet-stream'; if ($mime.ContainsKey($ext)) { $type = $mime[$ext] }
      Send $ctx 200 $type ([IO.File]::ReadAllBytes($full))
    } catch {
      try { SendText $ctx 500 'text/plain' ('server error: ' + $_.Exception.Message) } catch {}
    }
  }
