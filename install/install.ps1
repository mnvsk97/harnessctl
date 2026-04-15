# harnessctl installer for Windows (PowerShell)
# Usage: irm https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "mnvsk97/harnessctl"
$InstallDir = if ($env:HARNESSCTL_INSTALL_DIR) { $env:HARNESSCTL_INSTALL_DIR } else { "$env:USERPROFILE\.harnessctl\bin" }

function Write-Info($msg) { Write-Host "[harnessctl] $msg" -ForegroundColor Cyan }
function Write-Err($msg) { Write-Host "[harnessctl] $msg" -ForegroundColor Red; exit 1 }

# Detect architecture
$Arch = if ([System.Environment]::Is64BitOperatingSystem) {
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
} else {
    Write-Err "32-bit systems are not supported"
}

$Binary = "harnessctl-windows-${Arch}.exe"

# Get latest release
Write-Info "Fetching latest release..."
$Release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
$Version = $Release.tag_name -replace '^v', ''

if (-not $Version) {
    Write-Err "Could not determine latest version"
}

Write-Info "Installing harnessctl v${Version} (windows/${Arch})..."

$DownloadUrl = "https://github.com/$Repo/releases/download/v${Version}/${Binary}"

# Create install directory
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$TargetPath = Join-Path $InstallDir "harnessctl.exe"

# Download
try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $TargetPath -UseBasicParsing
} catch {
    Write-Err "Download failed: $DownloadUrl"
}

# Add to PATH if not already there
$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($CurrentPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$CurrentPath;$InstallDir", "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Info "Added $InstallDir to PATH"
}

Write-Info "Installed harnessctl to $TargetPath"
& $TargetPath --help
