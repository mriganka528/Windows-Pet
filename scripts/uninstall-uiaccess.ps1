#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BuildDirectory,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$CertificateThumbprint
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$manifestBytes = [IO.File]::ReadAllBytes((Join-Path $BuildDirectory 'build.json'))
$content = [System.Security.Cryptography.Pkcs.ContentInfo]::new($manifestBytes)
$signedManifest = [System.Security.Cryptography.Pkcs.SignedCms]::new($content, $true)
$signedManifest.Decode([IO.File]::ReadAllBytes((Join-Path $BuildDirectory 'build.p7s')))
$signedManifest.CheckSignature($true)
if ($signedManifest.SignerInfos.Count -ne 1 -or $signedManifest.SignerInfos[0].Certificate.Thumbprint -ne $CertificateThumbprint) {
    throw 'The manifest does not match the approved signer.'
}
$manifest = [Text.Encoding]::UTF8.GetString($manifestBytes).TrimStart([char]0xFEFF) | ConvertFrom-Json
if ($manifest.kind -ne 'nudge-local-uiaccess' -or $manifest.buildId -notmatch '^\d{8}-\d{6}-[a-f0-9]{8}$' -or
    $manifest.certificateThumbprint -ne $CertificateThumbprint) { throw 'Build identity does not match.' }
$installRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Nudge UIAccess'
$target = [IO.Path]::GetFullPath((Join-Path $installRoot $manifest.buildId))
$expectedPrefix = $installRoot.TrimEnd('\') + '\'
if (-not $target.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    (Resolve-Path -LiteralPath $target).Path -ne $target -or
    ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    ((Get-Item -LiteralPath $installRoot).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Refusing to remove an unexpected path or a link.'
}
$executable = Join-Path $target 'Nudge.exe'
$signature = Get-AuthenticodeSignature -LiteralPath $executable
if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $CertificateThumbprint) {
    throw 'The installed executable does not match this build.'
}
if ((Get-ChildItem -LiteralPath $target -Recurse -Force | Where-Object {
    $_.Attributes -band [IO.FileAttributes]::ReparsePoint
}).Count -gt 0) { throw 'Refusing to recursively remove a payload containing links.' }
Get-Process Nudge -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable } | Stop-Process
$shortcutPath = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Nudge (above notifications).lnk'
if (Test-Path -LiteralPath $shortcutPath) {
    $shell = New-Object -ComObject WScript.Shell
    if ($shell.CreateShortcut($shortcutPath).TargetPath -eq $executable) {
        Remove-Item -LiteralPath $shortcutPath
    }
}
# The resolved absolute version directory was verified against the fixed product
# directory above. Never delete Program Files or the shared product root.
Remove-Item -LiteralPath $target -Recurse -Force
$certificatePath = 'Cert:\LocalMachine\Root\' + $CertificateThumbprint
if (Test-Path -LiteralPath $certificatePath) { Remove-Item -LiteralPath $certificatePath }
Write-Output 'Removed this local UIAccess build and its signing certificate.'
