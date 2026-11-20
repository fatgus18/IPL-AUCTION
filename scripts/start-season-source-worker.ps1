param([switch]$InstallAtSignIn)
$ErrorActionPreference = 'Stop'
$workerRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$workerScript = Join-Path $workerRoot 'scripts/season-source-worker.mjs'
$workerEnvironment = Join-Path $workerRoot '.env.season-worker.local'
$workerData = Join-Path $workerRoot '.data'
$workerLock = Join-Path $workerData 'season-worker.lock'
if (-not (Test-Path -LiteralPath $workerEnvironment)) { throw 'Create .env.season-worker.local with the website origin and service credential first.' }
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$nodeMajor = [int]((& $nodeExecutable --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) { throw 'The Pavilion refresh service requires Node.js 24 or newer.' }
New-Item -ItemType Directory -Path $workerData -Force | Out-Null

if ($InstallAtSignIn) {
  $startupFolder = [Environment]::GetFolderPath('Startup')
  $startupLink = Join-Path $startupFolder 'Pavilion Points Refresh.lnk'
  $shellLink = (New-Object -ComObject WScript.Shell).CreateShortcut($startupLink)
  if ((Test-Path -LiteralPath $startupLink) -and -not $shellLink.Arguments.Contains($PSCommandPath)) { throw 'A different Pavilion startup shortcut already exists. Inspect it before replacing it.' }
  $shellLink.TargetPath = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
  $shellLink.Arguments = '-NoProfile -WindowStyle Hidden -File "' + $PSCommandPath + '"'
  $shellLink.WorkingDirectory = $workerRoot
  $shellLink.Description = 'Fetch public ESPN MVP points when the Pavilion website requests a refresh.'
  $shellLink.WindowStyle = 7
  $shellLink.Save()
  Write-Output 'Pavilion points refresh will start when you sign into Windows.'
}

if (Test-Path -LiteralPath $workerLock) {
  $lockState = Get-Content -LiteralPath $workerLock -Raw | ConvertFrom-Json
  $existingWorker = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$lockState.pid) -ErrorAction SilentlyContinue
  if ($existingWorker -and $existingWorker.CommandLine -and $existingWorker.CommandLine.Contains($workerScript)) {
    Write-Output 'Pavilion points refresh service is already running.'
    exit 0
  }
}

$workerArguments = @('--experimental-strip-types', ('--env-file="' + $workerEnvironment + '"'), ('"' + $workerScript + '"'))
$workerProcess = Start-Process -FilePath $nodeExecutable -ArgumentList $workerArguments -WorkingDirectory $workerRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $workerData 'season-worker.log') -RedirectStandardError (Join-Path $workerData 'season-worker.error.log')
Write-Output ('Started Pavilion points refresh service (process ' + $workerProcess.Id + ').')
