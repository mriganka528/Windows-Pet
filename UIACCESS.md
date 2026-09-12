# Drawing the pet above Windows notifications

Windows shell notifications can occupy a higher window band than ordinary
desktop windows. CSS `z-index`, Electron's `screen-saver` level, and repeated
`moveTop()` calls do not move an ordinary window into that band.

The UIAccess edition enables `uiAccess="true"` on **Nudge.exe**, preserves
`asInvoker`, and signs the executable after packaging. Windows requires the
signature to be trusted and the app to be installed in a protected location such
as Program Files. The development Electron executable and the ordinary per-user
installer do not have this capability.

## Prepare a local build

Run `npm.cmd run prepare:uiaccess`. This builds the renderer and native helper,
packages the app, updates its existing PE manifest, and signs it with a one-use
local code-signing certificate. It creates an `out/uiaccess/<build-id>/` folder
containing the app, a public `.cer` file, and `build.json` with the certificate
thumbprint and payload hashes. `build.p7s` signs that file list to protect the
payload between preparation and installation. The private signing key is not exported or saved.
Preparation does not install the app or change certificate trust.

For an offline build, pass `-Offline -NuGetPackages <existing-NuGet-cache>` to
`scripts/prepare-uiaccess.ps1`. `-BuilderCli` can select an existing
electron-builder 26.0.12 installation. An unfinished signing step can be resumed
with `-ResumeBuildDirectory <build-directory> -BuilderCli <electron-builder-cli>`.

The UIAccess runtime requires the packaged `app.asar` and its integrity check.
Running arbitrary Node scripts, `NODE_OPTIONS`, and main-process debugger flags
are disabled. Packaged builds also ignore development renderer/helper overrides.

## Install after approving the Windows trust change

Review `build.json` and the scripts first. In an **administrator PowerShell**:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-uiaccess.ps1 `
  -BuildDirectory '<prepared build directory>' `
  -CertificateThumbprint '<thumbprint from build.json>'
```

This verifies the payload, installs that build into
`C:\Program Files\Nudge UIAccess\<build-id>`, restricts modification to
Administrators and SYSTEM, and trusts **that certificate** in the machine's
Trusted Root store. The certificate is restricted to code signing and is not a
certificate authority. UIAccess permits interaction with higher-privilege
Windows UI; this is why the trust change is a separate, explicit installation
step. UAC, UIPI, and Windows' signature/location checks remain enabled.

Quit the development/per-user pet, then launch **Nudge (above notifications)**
from the desktop. Launch normally, not as administrator. `npm run dev` still
launches ordinary Electron and does not gain UIAccess from this installation.
The local certificate expires after one year. A distributable release should use
the publisher's trusted code-signing certificate instead of this local workflow.

## Verify the actual Windows layer

After launching the installed build, use its bundled helper with the overlay's
native handle:

```powershell
$petProcess = Get-Process Nudge | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
& '<installed build>\resources\watcher\NudgeWatcher.exe' --window-layer $petProcess.MainWindowHandle
```

The diagnostic reads the process's **actual token** and window band. Check
`UiAccess: true`; supported Windows builds report `WindowBand: 2` for UIAccess.
Then confirm with a real notification that the pet remains visible over its
message while its paw reaches the cross. Renderer tests alone do not validate
Windows shell layering.

## Remove this local build and its trust

Use `scripts/uninstall-uiaccess.ps1` in administrator PowerShell with the same
`-BuildDirectory` and `-CertificateThumbprint`. It removes only that build, its
matching shortcut, and its specific signing certificate. Saved pet preferences
and other installed builds are preserved.

Windows requirements: [UI Automation security overview](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview).
