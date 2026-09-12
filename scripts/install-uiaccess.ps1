<#
Administrator step, separate from preparation. Installs exactly one prepared
local build under Program Files and trusts its one-use code-signing certificate.
Does not disable UIPI, UAC, certificate validation, or secure-location checks.
#>
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BuildDirectory,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$CertificateThumbprint
)

$ErrorActionPreference = 'Stop'
$buildRoot = (Resolve-Path -LiteralPath $BuildDirectory).Path
Add-Type -AssemblyName System.Security
$manifestBytes = [IO.File]::ReadAllBytes((Join-Path $buildRoot 'build.json'))
$content = [System.Security.Cryptography.Pkcs.ContentInfo]::new($manifestBytes)
$signedManifest = [System.Security.Cryptography.Pkcs.SignedCms]::new($content, $true)
$signedManifest.Decode([IO.File]::ReadAllBytes((Join-Path $buildRoot 'build.p7s')))
# Validate the cryptographic signature against the explicitly approved signer.
# Root trust is intentionally not required yet: it is the pending install step.
$signedManifest.CheckSignature($true)
if ($signedManifest.SignerInfos.Count -ne 1 -or $signedManifest.SignerInfos[0].Certificate.Thumbprint -ne $CertificateThumbprint) {
    throw 'The payload manifest is not signed by the approved certificate.'
}
$manifest = [Text.Encoding]::UTF8.GetString($manifestBytes).TrimStart([char]0xFEFF) | ConvertFrom-Json
if ($manifest.kind -ne 'nudge-local-uiaccess' -or $manifest.buildId -notmatch '^\d{8}-\d{6}-[a-f0-9]{8}$' -or
    $manifest.certificateThumbprint -ne $CertificateThumbprint -or $manifest.executable -ne 'Nudge.exe') {
    throw 'The build identity does not match the approved build.'
}
$source = Join-Path $buildRoot 'package\win-unpacked'
$publicCertificate = Join-Path $buildRoot 'nudge-uiaccess.cer'
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($publicCertificate)
if ($certificate.Thumbprint -ne $CertificateThumbprint -or $certificate.HasPrivateKey -or $certificate.NotAfter -lt (Get-Date)) {
    throw 'The public signing certificate does not match the approved certificate or has expired.'
}

function Assert-Payload([string]$Directory) {
    $prefix = [IO.Path]::GetFullPath($Directory).TrimEnd('\') + '\'
    if ((Get-ChildItem -LiteralPath $Directory -Recurse -Force | Where-Object {
        $_.Attributes -band [IO.FileAttributes]::ReparsePoint
    }).Count -gt 0) { throw 'The payload must not contain links or reparse points.' }
    $actualFiles = @(Get-ChildItem -LiteralPath $Directory -File -Recurse)
    if ($actualFiles.Count -ne $manifest.files.Count) { throw 'Unexpected payload files.' }
    foreach ($file in $manifest.files) {
        $path = [IO.Path]::GetFullPath((Join-Path $Directory $file.path))
        if (-not $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or $file.path.Contains(':') -or
            (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256) {
            throw "Payload verification failed: $($file.path)"
        }
    }
    $signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $Directory 'Nudge.exe')
    if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $CertificateThumbprint -or
        $signature.Status -eq 'HashMismatch' -or $signature.Status -eq 'NotSigned') {
        throw 'The executable signature does not match this build.'
    }
}
Assert-Payload $source

# A fresh version directory avoids overwriting a running app or any other app.
$installRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Nudge UIAccess'
$destination = [IO.Path]::GetFullPath((Join-Path $installRoot $manifest.buildId))
if (-not $destination.StartsWith($installRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Invalid installation path.'
}
if (Test-Path -LiteralPath $destination) { throw 'This build is already installed.' }
if (Test-Path -LiteralPath $installRoot) {
    if ((Get-Item -LiteralPath $installRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'The installation root must not be a link.'
    }
    $marker = Join-Path $installRoot '.nudge-uiaccess'
    if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -Raw -LiteralPath $marker).Trim() -ne 'com.nudge.desktop.uiaccess') {
        throw 'The installation root already exists and is not managed by this installer.'
    }
}
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
# UIAccess code must not be modifiable by ordinary, unelevated processes.
$security = New-Object System.Security.AccessControl.DirectorySecurity
$security.SetAccessRuleProtection($true, $false)
$administrators = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$security.SetOwner($administrators)
foreach ($entry in @(@('S-1-5-18', 'FullControl'), @('S-1-5-32-544', 'FullControl'), @('S-1-5-32-545', 'ReadAndExecute'))) {
    $sid = [System.Security.Principal.SecurityIdentifier]::new($entry[0])
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, $entry[1],
        [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
        [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
}
Set-Acl -LiteralPath $installRoot -AclObject $security
'com.nudge.desktop.uiaccess' | Set-Content -LiteralPath (Join-Path $installRoot '.nudge-uiaccess') -Encoding ASCII
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $destination -Recurse
Assert-Payload $destination

# This is the trust change that requires explicit approval. The certificate is
# restricted to code signing, is not a CA, and its private key was destroyed.
Import-Certificate -FilePath $publicCertificate -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
$installedExe = Join-Path $destination 'Nudge.exe'
if ((Get-AuthenticodeSignature -LiteralPath $installedExe).Status -ne 'Valid') {
    throw 'Windows did not validate the installed signature. The app was not launched.'
}

$shortcutPath = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Nudge (above notifications).lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $installedExe
$shortcut.WorkingDirectory = $destination
$shortcut.Description = 'Nudge with Windows UIAccess for drawing above notifications'
$shortcut.Save()

[ordered]@{ installedPath = $destination; certificateThumbprint = $CertificateThumbprint; shortcut = $shortcutPath } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $buildRoot 'installed.json') -Encoding UTF8
Write-Output "Installed and verified: $installedExe"
Write-Output 'Quit the running development/per-user pet, then launch Nudge (above notifications) from the desktop.'
Write-Output 'Launch from the desktop as your normal user; the pet does not need to run as administrator.'
