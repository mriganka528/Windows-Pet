# Nudge product website

A complete, responsive product site for Nudge, with the app's actual animated
characters, real settings screenshots, interactive previews, guides, and the
Windows installer download.

## Deploy to Vercel

Use the Git repository as the deployment source, with these project settings:

| Setting                                            | Value                  |
| -------------------------------------------------- | ---------------------- |
| Root Directory                                     | `Product website`      |
| Include source files outside of the Root Directory | **Enabled**            |
| Framework Preset                                   | **Vite**               |
| Install Command                                    | `npm ci`               |
| Build Command                                      | `npm run build:vercel` |
| Output Directory                                   | `dist`                 |

`vercel.json` supplies the framework and commands. Set the root directory and
outside-source checkbox in Vercel. The checkbox is required because the site
imports the pet renderer from `../src`; the Windows app itself is not installed
or built on Vercel. The website's own lockfile and React resolution settings
support installing only this folder's dependencies.

Commit and push the updated website files, including `package-lock.json`,
`release.json`, and `vercel.json`, before redeploying. Vercel cannot see changes
that exist only on your computer. If you previously configured different build
overrides in Vercel, change them to the values above.

The npm `allow-scripts` message was advisory, not the cause of the failed build.
`package.json` now permits the reviewed `esbuild@0.21.5` install script and pins
that esbuild version. No interactive `npm approve-scripts` step is needed in CI.

## Publish the Windows download on GitHub

The site is configured for this direct release-asset URL:

```text
https://github.com/mriganka528/Windows-Pet/releases/download/Nudge-Setup/Nudge-Setup-0.1.1-x64.exe
```

This is the download URL supplied by the publisher. Its release tag is
**`Nudge-Setup`**, which is separate from the application version **`0.1.1`**.

1. Open [Windows-Pet releases](https://github.com/mriganka528/Windows-Pet/releases)
   and open the release tagged **`Nudge-Setup`**.
2. Attach **`D:\Windows Pet\dist\Nudge-Setup-0.1.1-x64.exe`** to the release.
   Keep that exact filename. You can also attach
   `Product website/public/downloads/SHA256SUMS.txt`.
3. Publish the release. Check that its EXE downloads in a signed-out browser.
4. Push the website changes and deploy with the Vercel settings above.

Do not add the 135 MB EXE to Git source files. Release assets are uploaded through
the release page. The release must be publicly downloadable; if your source
repository is private, use a separate public downloads repository and set the
site's `NUDGE_DOWNLOAD_URL` environment variable to that asset's direct HTTPS URL.

No environment variable is needed for the configured repository and tag. To use
a different host or URL, add **`NUDGE_DOWNLOAD_URL`** in Vercel's environment
variables for the applicable environments and redeploy. This is a public URL,
not a credential or token. It updates all download buttons and the fallback link
for visitors who have JavaScript disabled.

An existing `NUDGE_DOWNLOAD_URL` takes precedence over `release.json`. If it
contains the old link, update it to the URL above or remove it, then redeploy.

## Open the site locally

From `D:\Windows Pet\Product website`:

```powershell
npm.cmd run dev
```

Open **http://127.0.0.1:4176**. You can also double-click `Start website.cmd`.
Keep the terminal open while viewing the site. Press Ctrl+C to stop the server.

Install this website's dependencies with `npm.cmd ci` in this folder. Existing
development checkouts can also use the dependencies in the parent Nudge project.
Keep the source folder inside the Nudge project: the live pets deliberately
import the same character renderer and settings definitions as the app.

## Local and cloud builds

```powershell
npm.cmd run build
npm.cmd run preview
```

The **`Product website/dist`** folder is the complete, independent website.
With a local EXE present, `npm run build` bundles it for folder-based sharing.
On a clean checkout without the EXE, it uses the external release URL instead.
`npm run build:vercel` (or the `VERCEL=1` environment) always uses the external
URL and excludes generated EXE copies from the website, even on Windows.

Cloud builds read the committed **`release.json`** for the version, filename,
size, SHA-256 checksum, and GitHub URL. They need no EXE, .NET SDK, or Electron
runtime. `src/release.json` is generated for the UI and remains ignored by Git.
A mismatch between the app version and release metadata stops the build with
instructions to update the metadata, so an old checksum cannot label a new file.

For manual static hosting, upload all contents of the built `dist` folder. Use
the cloud build when hosting the installer on GitHub. No Node server, API,
database, or account system is needed in production. Relative assets support
hosting under a subdirectory.

Before publishing, replace
the relative Open Graph image URL in `index.html` with the absolute URL on your
chosen domain, and add a canonical URL for that domain if desired.

## Update the download

1. Update and build the Windows app in the parent project with
   `npm.cmd run dist:win`.
2. Run `npm.cmd run build` in this folder.
3. Publish the installer asset and put its exact public download URL in
   `release.json`, then commit the updated metadata. Rebuilding the same version
   preserves your supplied URL. A new version clears it so an older installer
   cannot be linked accidentally; release tags are never guessed from versions.
4. Push the changes so Vercel can rebuild the website.

The local preparation script reads the built installer, copies it into
`public/downloads`, and computes the release size and checksum. The cloud path
uses the committed metadata and links directly to GitHub. Neither path uploads
files to GitHub or deploys the website.

The website download directory keeps the current installer only. Earlier app
installers remain in the parent project's `dist` folder. The download area,
notification guide, and FAQ explain that Windows Do not disturb / Focus assist
must be off for the pet to interact with notification banners, and explain how
to enable Auto-close. Version 0.1.1 also shows this guidance once on first launch.

The executable and generated build files are ignored by Git. Keep the actual
installer with your local build or attach it to a release; do not commit this
large binary to the source repository. The current release is unsigned; the
website discloses this in its download area and installation guide.

## Screenshots and previews

- The interactive desktop, character picker, colors, moods, and feature cards
  render the app's real `SpriteCanvas` artwork.
- `public/images/settings.png` and `settings-full.png` capture the real
  `SettingsApp` renderer, using local example preferences in a browser. They are
  not screenshots of a completed installation on Windows.
- `character-roster.png` and `expressions.png` are the application's existing
  rendered art galleries.
- `desktop-preview.png` captures the site's illustrated desktop with the real
  pet renderer. The gallery identifies it as a browser preview.

To refresh app screenshots (installed Google Chrome required):

```powershell
npm.cmd run capture
```

With the development server running on port 4176, refresh the desktop and social
preview images:

```powershell
npm.cmd run capture:website
```

Build again after refreshing media. The site makes no external font, analytics,
or image requests, and its browser demos do not access Windows notifications,
audio, or cameras. The Windows app is still required for those real features.

## Check it

```powershell
npm.cmd run build
npm.cmd run test:build
npm.cmd run check
```

The checks start a temporary local preview on port 4177, use Chrome to exercise
the preview, animal/coat/mood choices, keyboard navigation, guides, gallery,
dialogs, and mobile menu. For a local build they download the installer and verify
its SHA-256. For a cloud build they check that the links match the configured
external URL; they do not fetch or certify the remote release asset.
They also check JavaScript errors, missing images, horizontal overflow at six
screen widths, and the download fallback without JavaScript. The temporary
preview and browser close afterwards.

`test:build` covers the original Vercel failure (no local EXE), local packaging,
cloud exclusion of binaries, URL overrides, and stale or invalid release data.

Reports and full-page screenshots are in `.cache/` (ignored by Git). The normal
development server on port 4176 is separate from the verification server.

## Main files

| File                           | Purpose                                                |
| ------------------------------ | ------------------------------------------------------ |
| `src/main.tsx`                 | Page sections, download links, gallery, and dialogs    |
| `src/Desktop.tsx`              | Petting, drag, dance, sleep, and notification demo     |
| `src/Pet.tsx`                  | Shared app artwork with visibility and motion controls |
| `src/content.ts`               | Companion descriptions, guides, and FAQs               |
| `src/styles.css`               | Responsive visual design and reduced motion styles     |
| `scripts/prepare-download.mjs` | Installer copy and release metadata                    |
| `release.json`                 | Committed release metadata and public GitHub asset URL |
| `vercel.json`                  | Cloud build and output settings                        |
| `public/images`                | Product screenshots and social preview                 |
