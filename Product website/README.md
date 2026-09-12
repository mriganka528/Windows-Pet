# Nudge product website

A complete, responsive product site for Nudge, with the app's actual animated
characters, real settings screenshots, interactive previews, guides, and the
Windows installer download.

## Open the site

From `D:\Windows Pet\Product website`:

```powershell
npm.cmd run dev
```

Open **http://127.0.0.1:4176**. You can also double-click `Start website.cmd`.
Keep the terminal open while viewing the site. Press Ctrl+C to stop the server.

The website uses the dependencies already installed in the parent Nudge project.
If setting up a new checkout, run `npm.cmd ci` in the parent folder first.
Keep the source folder inside the Nudge project: the live pets deliberately
import the same character renderer and settings definitions as the app.

## Build a website you can host

```powershell
npm.cmd run build
npm.cmd run preview
```

The **`Product website/dist`** folder is the complete, independent website.
Upload **all of its contents**, including `downloads`, `images`, and `assets`, to
a static web host. No Node server, API, database, accounts, or environment secrets
are needed in production. Asset paths also support hosting under a subdirectory.
The source files are not the deployable website; use the built `dist` folder.

The installer is about **135 MB**. Choose a host that accepts files of that size.
If your host has a smaller file limit, put the installer on your own release or
file host, then change `downloadUrl` in `src/main.tsx` and the no-JavaScript
download link in `index.html` to its public URL before rebuilding.

No deployment or public upload has been performed. Before publishing, replace
the relative Open Graph image URL in `index.html` with the absolute URL on your
chosen domain, and add a canonical URL for that domain if desired.

## Update the download

1. Update and build the Windows app in the parent project with
   `npm.cmd run dist:win`.
2. Run `npm.cmd run build` in this folder.

The preparation script reads the app version from the parent's `package.json`,
copies `dist/Nudge-Setup-<version>-x64.exe` into `public/downloads`, and generates
the visible version, file size, and SHA-256 checksum. It refuses to build if the
installer is missing. It does not upload the installer anywhere.

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
npm.cmd run check
```

The checks start a temporary local preview on port 4177, use Chrome to exercise
the preview, animal/coat/mood choices, keyboard navigation, guides, gallery,
dialogs, and mobile menu, then download the installer and verify its SHA-256.
They also check JavaScript errors, missing images, horizontal overflow at six
screen widths, and the download fallback without JavaScript. The temporary
preview and browser close afterwards.

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
| `public/images`                | Product screenshots and social preview                 |
