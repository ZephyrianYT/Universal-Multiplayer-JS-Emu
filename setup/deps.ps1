<#
Retro Hub dependency setup (Windows).

Checks for what Retro Hub needs, asks before installing anything, downloads only from each
project's official source into a new empty folder, and checks every download before using it:
  1. the URL is on the official host,
  2. SHA-256 matches the publisher's published checksum (when the publisher has one),
  3. the Authenticode signature is valid and signed by the expected publisher (installers),
  4. a Microsoft Defender scan finds nothing.
Any failed check stops that item; nothing unverified is ever run.

  Python 3 ...... python.org          (sha256 from the python.org API, signed "Python Software Foundation")
  Node.js LTS ... nodejs.org          (sha256 from SHASUMS256.txt, signed "OpenJS Foundation")
  ViGEmBus ...... github.com/nefarius (no checksum published; signature "Nefarius" + Defender)
  vgamepad ...... pypi.org            (sha256 from the PyPI JSON API + Defender)

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File setup\deps.ps1 [-Need python,node,vigembus,vgamepad]
         [-Python C:\path\python.exe] [-Yes] [-Check] [-DownloadOnly]
  -Need          items to handle (default: all). Items already installed are skipped.
  -Python        the Python that vgamepad goes into (default: the one found on PATH).
  -Yes           don't ask (the Retro Hub window has already asked).
  -Check         only print one JSON line saying what is installed, then exit.
  -DownloadOnly  download and verify, but don't install (for testing).
Exit code: 0 = everything asked for is installed (or verified with -DownloadOnly), 1 = something is missing or failed.
#>
param(
  [string[]]$Need = @("python", "node", "vigembus", "vgamepad"),
  [string]$Python = "",
  [switch]$Yes,
  [switch]$Check,
  [switch]$DownloadOnly
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # Invoke-WebRequest is many times slower with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Need = @($Need | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })

function Say([string]$msg) { Write-Host $msg }

# ------------------------------------------------------------------ PATH refresh (after an install)
function Update-Path {
  $m = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $u = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = (@($m, $u) | Where-Object { $_ }) -join ";"
}

# ------------------------------------------------------------------ detection
# Windows has Microsoft Store shortcuts named python.exe / py.exe even without Python, so only a
# Python that really runs (3.8+, with tkinter for the Retro Hub window) counts.
function Find-Python {
  $cands = @("py|-3", "python", "python3")                  # "exe|arg" (no '|' appears in a Windows path)
  if ($Python -and (Test-Path $Python)) { $cands = @($Python) + $cands }
  foreach ($cand in $cands) {
    $c = $cand -split "\|"; $exe = $c[0]; $pre = @($c | Select-Object -Skip 1)
    try {
      $out = & $exe @pre -c "import sys, tkinter; print(sys.executable) if sys.version_info >= (3, 8) else sys.exit(1)" 2>$null
      if ($LASTEXITCODE -eq 0 -and $out) { return ([string]($out | Select-Object -Last 1)).Trim() }
    } catch {}
  }
  return $null
}
function Find-Node {
  try {
    $v = & node --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $v -match '^v(\d+)\.' -and [int]$Matches[1] -ge 18) { return $v.Trim() }
  } catch {}
  return $null
}
function Test-ViGEmBus {
  if (Get-Service -Name ViGEmBus -ErrorAction SilentlyContinue) { return $true }
  return [bool](Get-PnpDevice -FriendlyName "*Virtual Gamepad Emulation Bus*" -ErrorAction SilentlyContinue)
}
function Test-VGamepad([string]$py) {
  if (-not $py) { return $false }
  # find_spec, not import: importing vgamepad without the driver can open its installer.
  & $py -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('vgamepad') else 1)" 2>$null
  return ($LASTEXITCODE -eq 0)
}

function Get-State {
  $py = Find-Python
  [ordered]@{
    python   = [bool]$py
    pythonPath = $py
    node     = [bool](Find-Node)
    vigembus = [bool](Test-ViGEmBus)
    vgamepad = [bool](Test-VGamepad $py)
  }
}

# ------------------------------------------------------------------ download + safety check
$AllowedHosts = @("www.python.org", "nodejs.org", "github.com", "objects.githubusercontent.com",
  "release-assets.githubusercontent.com", "pypi.org", "files.pythonhosted.org")

function Find-MpCmdRun {
  $p = Join-Path $env:ProgramFiles "Windows Defender\MpCmdRun.exe"
  $plat = Get-ChildItem "$env:ProgramData\Microsoft\Windows Defender\Platform" -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
  if ($plat -and (Test-Path (Join-Path $plat.FullName "MpCmdRun.exe"))) { return (Join-Path $plat.FullName "MpCmdRun.exe") }
  if (Test-Path $p) { return $p }
  return $null
}

# Returns the verified file's path, or throws with the reason.
function Get-Verified {
  param([string]$Name, [string]$Url, [string]$Sha256 = "", [string]$Signer = "")
  $uri = [Uri]$Url
  if ($uri.Scheme -ne "https" -or $AllowedHosts -notcontains $uri.Host) { throw "$Name : refusing to download from $($uri.Host) (not an official source)." }

  $dir = Join-Path $env:TEMP ("RetroHub-setup\" + $Name + "-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $file = Join-Path $dir ([IO.Path]::GetFileName($uri.AbsolutePath))
  Say "  Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $file -UseBasicParsing
  # Redirects (GitHub release assets) must also end on an official host: Invoke-WebRequest follows them,
  # so this checks the request we made; the signature check below covers the content itself.

  $hash = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
  if ($Sha256) {
    if ($hash -ne $Sha256.ToLower()) { Remove-Item $dir -Recurse -Force; throw "$Name : SHA-256 does not match the publisher's checksum. Download deleted." }
    Say "  SHA-256 matches the publisher's checksum."
  } else {
    Say "  SHA-256 $hash (the publisher doesn't publish one)."
  }

  if ($Signer) {
    $sig = Get-AuthenticodeSignature $file
    $subj = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { "" }
    if ($sig.Status -ne "Valid" -or $subj -notmatch $Signer) {
      Remove-Item $dir -Recurse -Force
      throw "$Name : signature check failed (status $($sig.Status), signer '$subj'). Download deleted."
    }
    Say "  Signature valid: $(($subj -split ',')[0] -replace '^CN=', '')."
  }

  $mp = Find-MpCmdRun
  if (-not $mp) { Remove-Item $dir -Recurse -Force; throw "$Name : Microsoft Defender isn't available to scan the download, so it wasn't used." }
  $scan = & $mp -Scan -ScanType 3 -File $file -DisableRemediation 2>&1
  if ($LASTEXITCODE -ne 0) {
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
    throw "$Name : Defender scan did not come back clean (code $LASTEXITCODE). Download deleted. $($scan | Select-Object -Last 2)"
  }
  Say "  Defender scan: clean."
  return $file
}

function Confirm-Item([string]$what) {
  if ($Yes) { return $true }
  $a = Read-Host "$what Download and install it now? [Y/n]"
  return (-not $a -or $a -match '^[yY]')
}

function Invoke-Installer([string]$file, [string[]]$arguments) {
  # Start-Process refuses an empty -ArgumentList, so only pass it when there is something to pass.
  if ($arguments -and $arguments.Count) { $p = Start-Process -FilePath $file -ArgumentList $arguments -Wait -PassThru }
  else { $p = Start-Process -FilePath $file -Wait -PassThru }
  if ($p.ExitCode -notin 0, 3010, 1641) { throw "installer exited with code $($p.ExitCode)." }
  if ($p.ExitCode -ne 0) { Say "  Windows needs a restart to finish this install." }
}

# ------------------------------------------------------------------ items
function Install-Python {
  Say "Python 3: looking up the latest release on python.org..."
  $rels = @(Invoke-RestMethod "https://www.python.org/api/v2/downloads/release/?is_published=true&pre_release=false&version=3")
  $top = $rels | ForEach-Object { $_ } | Where-Object { $_.name -match '^Python 3\.\d+\.\d+$' } |
    Sort-Object { [version]($_.name -replace '^Python ', '') } -Descending | Select-Object -First 1
  if (-not $top) { throw "Python: python.org didn't list a release." }
  $id = ($top.resource_uri.TrimEnd("/") -split "/")[-1]
  $f = (Invoke-RestMethod "https://www.python.org/api/v2/downloads/release_file/?release=$id") |
    Where-Object { $_.url -match '-amd64\.exe$' } | Select-Object -First 1
  if (-not $f -or -not $f.sha256_sum) { throw "Python: no 64-bit installer with a checksum for $($top.name)." }
  $file = Get-Verified -Name "python" -Url $f.url -Sha256 $f.sha256_sum -Signer "Python Software Foundation"
  if ($DownloadOnly) { Say "  $($top.name) verified (not installed: -DownloadOnly)."; return }
  Say "  Installing $($top.name) for this user (with tkinter, pip and the py launcher, added to PATH)..."
  Invoke-Installer $file @("/passive", "InstallAllUsers=0", "PrependPath=1", "Include_tcltk=1", "Include_pip=1", "Include_launcher=1")
  Update-Path
}

function Install-Node {
  Say "Node.js: looking up the current LTS on nodejs.org..."
  # Parentheses: Windows PowerShell 5.1 otherwise passes a JSON array down the pipeline as one object.
  $lts = (Invoke-RestMethod "https://nodejs.org/dist/index.json") | Where-Object { $_.lts } | Select-Object -First 1
  if (-not $lts) { throw "Node.js: nodejs.org didn't list an LTS release." }
  $v = $lts.version; $msi = "node-$v-x64.msi"
  $sums = (Invoke-WebRequest "https://nodejs.org/dist/$v/SHASUMS256.txt" -UseBasicParsing).Content
  $line = ($sums -split "`n") | Where-Object { $_ -match ("\s" + [regex]::Escape($msi) + "\s*$") } | Select-Object -First 1
  if (-not $line) { throw "Node.js: no checksum for $msi." }
  $sha = ($line.Trim() -split '\s+')[0]
  $file = Get-Verified -Name "node" -Url "https://nodejs.org/dist/$v/$msi" -Sha256 $sha -Signer "OpenJS Foundation"
  if ($DownloadOnly) { Say "  Node.js $v verified (not installed: -DownloadOnly)."; return }
  Say "  Installing Node.js $v (Windows asks for permission)..."
  Invoke-Installer "msiexec.exe" @("/i", "`"$file`"", "/passive", "/norestart")
  Update-Path
}

function Install-ViGEmBus {
  Say "ViGEmBus (virtual controller driver): looking up the latest release on GitHub..."
  $rel = Invoke-RestMethod "https://api.github.com/repos/nefarius/ViGEmBus/releases/latest" -Headers @{ "User-Agent" = "RetroHub-setup" }
  $asset = $rel.assets | Where-Object { $_.name -match '^ViGEmBus_.*\.exe$' } | Select-Object -First 1
  if (-not $asset) { throw "ViGEmBus: no installer in release $($rel.tag_name)." }
  $sha = if ($asset.digest -match '^sha256:([0-9a-f]{64})$') { $Matches[1] } else { "" }
  $file = Get-Verified -Name "vigembus" -Url $asset.browser_download_url -Sha256 $sha -Signer "Nefarius"
  if ($DownloadOnly) { Say "  ViGEmBus $($rel.tag_name) verified (not installed: -DownloadOnly)."; return }
  Say "  Running the ViGEmBus $($rel.tag_name) installer (Windows asks for permission; follow its window)..."
  Invoke-Installer $file @()
}

function Install-VGamepad([string]$py) {
  if (-not $py) { throw "vgamepad: no Python to install it into." }
  Say "vgamepad (Python package for virtual controllers): looking it up on PyPI..."
  $meta = Invoke-RestMethod "https://pypi.org/pypi/vgamepad/json"
  $pick = $meta.urls | Where-Object { $_.packagetype -eq "bdist_wheel" -and $_.filename -match 'win_amd64|none-any' } | Select-Object -First 1
  if (-not $pick) { $pick = $meta.urls | Where-Object { $_.packagetype -eq "sdist" } | Select-Object -First 1 }
  if (-not $pick) { throw "vgamepad: PyPI has no download for $($meta.info.version)." }
  $file = Get-Verified -Name "vgamepad" -Url $pick.url -Sha256 $pick.digests.sha256
  if ($DownloadOnly) { Say "  vgamepad $($meta.info.version) verified (not installed: -DownloadOnly)."; return }
  Say "  Installing vgamepad $($meta.info.version) into $py ..."
  & $py -m pip install --disable-pip-version-check --no-warn-script-location $file
  if ($LASTEXITCODE -ne 0) { throw "vgamepad: pip install failed (code $LASTEXITCODE)." }
}

# ------------------------------------------------------------------ main
$state = Get-State
if ($Check) { $state | ConvertTo-Json -Compress; exit 0 }

$labels = [ordered]@{
  python   = "Python 3 (runs the Retro Hub window and the emulator runner) from python.org."
  node     = "Node.js (runs the hub server) from nodejs.org."
  vigembus = "ViGEmBus driver (guest controllers for native emulators) from its official GitHub release."
  vgamepad = "vgamepad Python package (guest controllers) from PyPI."
}
$failed = @(); $skipped = @()
foreach ($item in @("python", "node", "vigembus", "vgamepad")) {   # this order: vgamepad needs Python and the driver
  if ($Need -notcontains $item) { continue }
  if ($item -in "vigembus", "vgamepad") { $state = Get-State }     # Python / the driver may have just been installed
  if ($state[$item] -and -not $DownloadOnly) { Say "$($item): already installed."; continue }
  if (-not (Confirm-Item "Missing: $($labels[$item])")) { $skipped += $item; Say "  Skipped."; continue }
  try {
    switch ($item) {
      "python"   { Install-Python }
      "node"     { Install-Node }
      "vigembus" { Install-ViGEmBus }
      "vgamepad" { Install-VGamepad $state.pythonPath }
    }
  } catch {
    $failed += $item
    Say "  FAILED: $($_.Exception.Message)"
  }
}

if (-not $DownloadOnly) {
  $state = Get-State
  $missing = @($Need | Where-Object { $state.Contains($_) -and -not $state[$_] })
  if ($missing.Count) { Say ("Still missing: " + ($missing -join ", ")); exit 1 }
  # A step can fail and still end installed (vgamepad's own setup can install the ViGEmBus driver), so the
  # final check is what counts.
  Say "Everything Retro Hub needs is installed."
  exit 0
}
if ($failed.Count) { exit 1 }
exit 0
