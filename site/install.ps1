# Grove CLI installer for Windows
# Usage: irm https://i.captainsafia.sh/captainsafia/grove | iex
# Usage with version: $env:GROVE_VERSION='v1.0.0'; irm https://i.captainsafia.sh/captainsafia/grove | iex
# Usage with preview: $env:GROVE_PREVIEW='1'; irm https://i.captainsafia.sh/captainsafia/grove | iex

param(
    [string]$Version = $env:GROVE_VERSION,
    [switch]$Preview = [bool]$env:GROVE_PREVIEW
)

$ErrorActionPreference = 'Stop'

$Repo = "captainsafia/grove"
$InstallDir = if ($env:GROVE_INSTALL_DIR) { $env:GROVE_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "grove\bin" }
$BinaryName = "grove.exe"

function Get-Architecture {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    switch ($arch) {
        "X64" { return "x64" }
        "Arm64" { return "arm64" }
        default { return "unknown" }
    }
}

function Get-LatestVersion {
    try {
        $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -ErrorAction Stop
        return $response.tag_name
    } catch {
        return $null
    }
}

function Get-LatestPreviewVersion {
    try {
        $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases" -ErrorAction Stop
        $preview = $releases | Where-Object { $_.prerelease -eq $true } | Select-Object -First 1
        if ($preview) {
            return $preview.tag_name
        }
        return $null
    } catch {
        return $null
    }
}

function Add-ToPath {
    param([string]$Path)

    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -notlike "*$Path*") {
        $newPath = "$currentPath;$Path"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        return $true
    }
    return $false
}

function Main {
    Write-Host "🌳 Installing Grove CLI..." -ForegroundColor Green
    Write-Host ""

    $arch = Get-Architecture
    if ($arch -eq "unknown") {
        Write-Host "Error: Unsupported architecture" -ForegroundColor Red
        exit 1
    }

    Write-Host "Detected: windows-$arch"

    # Construct binary name
    $binaryFile = "grove-windows-$arch.exe"

    # Determine version to install
    if ($Version) {
        # Ensure version starts with 'v'
        if (-not $Version.StartsWith("v")) {
            $Version = "v$Version"
        }
        Write-Host "Requested version: $Version"
    } elseif ($Preview) {
        Write-Host "Fetching latest preview release..."
        $Version = Get-LatestPreviewVersion
        if (-not $Version) {
            Write-Host "Error: No preview releases available" -ForegroundColor Red
            exit 1
        }
        Write-Host "Latest preview: $Version"
    } else {
        Write-Host "Fetching latest release..."
        $Version = Get-LatestVersion
        if (-not $Version) {
            Write-Host "Error: No stable releases available yet." -ForegroundColor Red
            Write-Host ""
            Write-Host "To install the latest preview release, run:"
            Write-Host '  $env:GROVE_PREVIEW="1"; irm https://i.captainsafia.sh/captainsafia/grove | iex'
            exit 1
        }
        Write-Host "Latest version: $Version"
    }

    # Download URL
    $downloadUrl = "https://github.com/$Repo/releases/download/$Version/$binaryFile"

    # Create install directory
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    # Download binary
    $tempFile = Join-Path $InstallDir "$BinaryName.tmp"
    $targetFile = Join-Path $InstallDir $BinaryName

    Write-Host "Downloading $binaryFile..."
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile -ErrorAction Stop
    } catch {
        Remove-Item -Path $tempFile -ErrorAction SilentlyContinue
        Write-Host "Error: Failed to download $binaryFile" -ForegroundColor Red
        Write-Host "URL: $downloadUrl"
        exit 1
    }

    # Move to final location
    Move-Item -Path $tempFile -Destination $targetFile -Force

    Write-Host ""
    if ($Preview) {
        Write-Host "✅ Grove $Version (preview) installed successfully to $targetFile" -ForegroundColor Green
    } else {
        Write-Host "✅ Grove $Version installed successfully to $targetFile" -ForegroundColor Green
    }
    Write-Host ""

    # Check if install dir is in PATH
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -notlike "*$InstallDir*") {
        $addToPath = Add-ToPath -Path $InstallDir
        if ($addToPath) {
            Write-Host "Added $InstallDir to your PATH." -ForegroundColor Cyan
            Write-Host ""
            Write-Host "Please restart your terminal, then run 'grove --help' to get started."
        }
    } else {
        Write-Host "Grove is ready to use! Run 'grove --help' to get started."
    }

    Write-Host ""
    Write-Host "Tip: For shell integration (to use 'grove go' to change directories), add this to your PowerShell profile:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host '  Invoke-Expression (grove shell-init pwsh)' -ForegroundColor Cyan
    Write-Host ""
    Write-Host "You can edit your profile with: notepad `$PROFILE"
}

Main
