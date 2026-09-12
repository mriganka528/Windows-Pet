# Build and share the Windows installer

The recipient installs **Nudge Setup.exe** and the pet launches automatically.
Node.js, npm, Visual Studio, and .NET are build tools only: the installer includes
Electron and the native helper's .NET runtime.

## Build on your computer

Use Windows x64 with Node.js/npm and the .NET 8 SDK or newer installed. Internet
access is needed for the first build to download the packaging tools and native
runtime packs.
The commands use the pinned `electron-builder` version 26.0.12 through `npx`;
there is no global packaging-tool installation to manage.

```powershell
npm.cmd install
npm.cmd run dist:win
```

The command builds the app, publishes the native notification/audio helper with
its runtime, and creates:

```text
dist/Nudge-Setup-0.1.1-x64.exe
```

Share that installer. Do not share `out/main/index.js`, the helper's exe, or
`dist/win-unpacked/Nudge.exe` by itself; those are components, not installers.
The version in the filename follows `package.json`.

For a folder build for local testing, use `npm.cmd run pack:win`. Run
`dist/win-unpacked/Nudge.exe` while keeping that entire folder together.

## What the recipient does

1. Run the installer on a Windows 10/11 x64 computer. It installs for the current
   user, creates shortcuts, and starts Nudge when installation finishes.
2. Use the paw icon in the system tray to open Settings or quit.
3. Allow notification access if Windows requests it. Desktop roaming and music
   reactions do not depend on notification permission.
4. To launch at every Windows sign-in, enable **Start with Windows** in Settings.

The installer does not change Windows' Do Not Disturb settings. Dancing uses the
read-only playback meter included with the native helper.

On first launch, a separate Nudge popup explains notification setup. It closes
after 25 seconds (the timer pauses during interaction), or immediately with the
close button, **Got it**, or Escape. It appears once per saved user profile,
including the first launch after upgrading from a version without this notice.
The tray's **Notification setup…** item reopens it later.

For visible notification reactions and Auto-close, switch **Do not disturb off**
in Windows 11 Settings → System → Notifications. On Windows 10, switch **Focus
assist off** in Settings → System. Keep notification banners enabled, grant
notification access if requested, and choose **Close them for me** under Nudge
Settings → Behavior. Windows can enable DND automatically; the popup is guidance
and does not read or change that Windows setting.

## Before sharing broadly

Test installation, notification access, music reactions, sleep/wake, and
uninstallation on a clean Windows computer with no developer tools or .NET
installed. Notification permission is controlled by Windows and cannot be granted
silently by this installer.

An unsigned installer can show **Unknown publisher** or a SmartScreen warning.
For public distribution, sign the application and installer with a Windows code
signing certificate or a supported signing service. Configure signing credentials
through the build environment, not committed files. Do not ask users to disable
antivirus or Windows security protections.

To release an update, increase `package.json`'s version (and the lockfile), run
the build again, and share the new installer. Keep the app ID
`com.nudge.desktop` stable so upgrades use the same installation. Building with
these commands never uploads or publishes files anywhere.

## Build with GitHub Actions instead

After putting this project in your GitHub repository, open **Actions → Build
Windows installer → Run workflow**. When it finishes, download the
**Nudge-Windows-x64-installer** artifact. It contains the setup EXE and its SHA-256
checksum. This workflow runs only when you request it; it does not publish a
GitHub release or distribute the installer to anyone automatically.
