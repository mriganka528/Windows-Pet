<#
Build a LOCAL UIAccess edition without installing anything or changing certificate
trust. Windows checks the executable's signature and protected install location.
The one-use signing key is destroyed after signing; only its public certificate
is saved for the separate, explicitly approved administrator installation.
#>
[CmdletBinding()]
param([string]$BuilderCli, [string]$NuGetPackages, [switch]$Offline, [string]$ResumeBuildDirectory)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
if ($NuGetPackages) { $env:NUGET_PACKAGES = (Resolve-Path -LiteralPath $NuGetPackages).Path }
$buildId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$buildDirectory = Join-Path $workspace ('out\uiaccess\' + $buildId)
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null

if ($ResumeBuildDirectory) {
    $buildDirectory = (Resolve-Path -LiteralPath $ResumeBuildDirectory).Path
    $buildId = Split-Path -Leaf $buildDirectory
    if (-not $buildDirectory.StartsWith((Join-Path $workspace 'out\uiaccess\'), [StringComparison]::OrdinalIgnoreCase) -or
        $buildId -notmatch '^\d{8}-\d{6}-[a-f0-9]{8}$' -or (Test-Path -LiteralPath (Join-Path $buildDirectory 'build.p7s'))) {
        throw 'Resume requires an unfinished build inside this workspace.'
    }
} else {
if (-not $BuilderCli) {
    $candidates = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'npm-cache\_npx\*\node_modules\electron-builder\package.json') -ErrorAction SilentlyContinue
    $builderPackage = $candidates | Where-Object {
        (Get-Content -Raw -LiteralPath $_.FullName | ConvertFrom-Json).version -eq '26.0.12'
    } | Select-Object -First 1
    if (-not $builderPackage) { throw 'electron-builder 26.0.12 is required. Pass its cli.js path with -BuilderCli.' }
    $BuilderCli = Join-Path $builderPackage.DirectoryName 'cli.js'
}

Push-Location $workspace
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'App build failed.' }
    if ($Offline) {
        if (-not $env:NUGET_PACKAGES) { throw 'Offline preparation requires -NuGetPackages pointing at an existing package cache.' }
        & dotnet restore native/NudgeWatcher/NudgeWatcher.csproj --runtime win-x64 --source $env:NUGET_PACKAGES -p:NuGetAudit=false --nologo
        if ($LASTEXITCODE -ne 0) { throw 'Offline native restore failed.' }
        & node scripts/publish-watcher.mjs --no-restore
    } else {
        & npm.cmd run watcher:publish
    }
    if ($LASTEXITCODE -ne 0) { throw 'Native helper publish failed.' }
    # The final executable is patched and signed below, after all packaging edits.
    & node $BuilderCli --win --x64 --dir --publish never "--config.directories.output=$buildDirectory\package" `
        --config.win.signAndEditExecutable=false `
        --config.electronFuses.runAsNode=false `
        --config.electronFuses.enableNodeOptionsEnvironmentVariable=false `
        --config.electronFuses.enableNodeCliInspectArguments=false `
        --config.electronFuses.enableEmbeddedAsarIntegrityValidation=true `
        --config.electronFuses.onlyLoadAppFromAsar=true
    if ($LASTEXITCODE -ne 0) { throw 'Electron packaging failed.' }
} finally { Pop-Location }
}

$appDirectory = Join-Path $buildDirectory 'package\win-unpacked'
$executable = Join-Path $appDirectory 'Nudge.exe'
$unsignedImage = Join-Path $buildDirectory 'Nudge.unsigned.exe'
if ($ResumeBuildDirectory) {
    if (-not (Test-Path -LiteralPath $unsignedImage)) { throw 'This unfinished build has no unsigned image; prepare a fresh build.' }
    Copy-Item -LiteralPath $unsignedImage -Destination $executable -Force
} else {
    # Always resume from the unsigned packed image. Updating PE resources on an
    # already Authenticode-signed image can leave a stale certificate table.
    Copy-Item -LiteralPath $executable -Destination $unsignedImage
}
if (-not $BuilderCli) { throw 'Signature preparation requires -BuilderCli to verify the Electron fuses.' }
& node (Join-Path $PSScriptRoot 'verify-uiaccess-fuses.mjs') $executable $BuilderCli
if ($LASTEXITCODE -ne 0) { throw 'UIAccess runtime restrictions are missing.' }
Add-Type -Path (Join-Path $PSScriptRoot 'UiAccessImage.cs') -ReferencedAssemblies @('System.dll', 'System.Xml.dll')
[NudgeBuild.UiAccessImage]::Enable($executable)
if (-not [NudgeBuild.UiAccessImage]::IsEnabled($executable)) { throw 'UIAccess manifest verification failed.' }

$rsa = [System.Security.Cryptography.RSACng]::new(3072)
$certificate = $null
try {
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
        "CN=Nudge local UIAccess build $buildId", $rsa,
        [System.Security.Cryptography.HashAlgorithmName]::SHA256,
        [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
        [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature, $true))
    $purposes = [System.Security.Cryptography.OidCollection]::new()
    [void]$purposes.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3'))
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($purposes, $true))
    $certificate = $request.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5), [DateTimeOffset]::Now.AddYears(1))
    $signature = Set-AuthenticodeSignature -LiteralPath $executable -Certificate $certificate -HashAlgorithm SHA256
    if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint -or
        $signature.Status -eq 'HashMismatch' -or $signature.Status -eq 'NotSigned') {
        throw "Signing failed: $($signature.Status) $($signature.StatusMessage)"
    }
    # No certificate-store import here. Only public DER bytes are written.
    [IO.File]::WriteAllBytes((Join-Path $buildDirectory 'nudge-uiaccess.cer'),
        $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
    $thumbprint = $certificate.Thumbprint
    $expires = $certificate.NotAfter.ToUniversalTime().ToString('o')
$prefix = $appDirectory.TrimEnd('\') + '\'
$files = @(Get-ChildItem -LiteralPath $appDirectory -File -Recurse | ForEach-Object {
    [ordered]@{ path = $_.FullName.Substring($prefix.Length); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
})
$manifest = [ordered]@{
    buildId = $buildId
    kind = 'nudge-local-uiaccess'
    certificateThumbprint = $thumbprint
    certificateExpires = $expires
    executable = 'Nudge.exe'
    files = $files
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $buildDirectory 'build.json') -Encoding UTF8
# Authenticate the file list too, so writable staging files cannot be replaced
# between review and the elevated installation by changing both a file and hash.
Add-Type -AssemblyName System.Security
$content = [System.Security.Cryptography.Pkcs.ContentInfo]::new([IO.File]::ReadAllBytes((Join-Path $buildDirectory 'build.json')))
$signedManifest = [System.Security.Cryptography.Pkcs.SignedCms]::new($content, $true)
$signer = [System.Security.Cryptography.Pkcs.CmsSigner]::new($certificate)
$signer.IncludeOption = [System.Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly
$signer.DigestAlgorithm = [System.Security.Cryptography.Oid]::new('2.16.840.1.101.3.4.2.1')
$signedManifest.ComputeSignature($signer, $true)
[IO.File]::WriteAllBytes((Join-Path $buildDirectory 'build.p7s'), $signedManifest.Encode())
} finally {
    if ($certificate) { $certificate.Dispose() }
    $rsa.Dispose()
}
Write-Output "Prepared: $buildDirectory"
Write-Output "Certificate: $thumbprint (public certificate only; signing key destroyed)"
Write-Output 'Not installed. No certificate trust, registry settings, or system permissions were changed.'
