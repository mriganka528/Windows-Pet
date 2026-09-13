import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultSite = dirname(dirname(fileURLToPath(import.meta.url)))

async function digest(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex').toUpperCase()
}

function validateDownloadUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(
      'Set NUDGE_DOWNLOAD_URL or release.json downloadUrl to the public HTTPS installer URL.'
    )
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('The installer URL must use HTTPS and must not contain credentials.')
  }
  return url.href
}

function validateRelease(release, version, fileName) {
  if (
    release?.version !== version ||
    release.fileName !== fileName ||
    !Number.isSafeInteger(release.bytes) ||
    release.bytes < 1024 * 1024 ||
    !/^[A-Fa-f0-9]{64}$/.test(release.sha256 ?? '')
  ) {
    throw new Error(
      `release.json does not describe Nudge ${version}. Build that Windows installer locally, run npm run build in this folder, and commit the updated release.json.`
    )
  }
}

/** Cloud builds use committed metadata and an external URL; no Windows files or SDKs are needed. */
export async function prepareDownload({
  site = defaultSite,
  env = process.env,
  cloud = env.VERCEL === '1'
} = {}) {
  const workspace = dirname(site)
  const { version } = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8'))
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid application version.')
  const fileName = `Nudge-Setup-${version}-x64.exe`
  const installer = join(workspace, 'dist', fileName)
  const manifest = join(site, 'release.json')
  const previous = await readFile(manifest, 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
  const externalOverride = env.NUDGE_DOWNLOAD_URL?.trim()
  // Never look for or publish a Windows binary during a Vercel build.
  const info =
    cloud || externalOverride
      ? null
      : await stat(installer).catch((error) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
  const downloads = join(site, 'public', 'downloads')
  await mkdir(downloads, { recursive: true })
  await mkdir(join(site, 'src'), { recursive: true })
  let metadata
  let downloadUrl
  let downloadMode

  if (info) {
    if (!info.isFile() || info.size < 1024 * 1024)
      throw new Error('The local installer is incomplete.')
    const sha256 = await digest(installer)
    // Keep GitHub release URLs aligned when preparing a newly versioned installer.
    const github = previous?.downloadUrl?.match(
      /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\//
    )
    metadata = {
      version,
      fileName,
      bytes: info.size,
      sha256,
      downloadUrl: github
        ? `https://github.com/${github[1]}/releases/download/v${version}/${fileName}`
        : previous?.version === version
          ? (previous.downloadUrl ?? null)
          : null
    }
    const target = join(downloads, fileName)
    const targetStat = await stat(target).catch(() => null)
    if (!targetStat || targetStat.size !== info.size || (await digest(target)) !== sha256) {
      await copyFile(installer, target)
    }
    await writeFile(manifest, JSON.stringify(metadata, null, 2) + '\n')
    downloadUrl = `downloads/${fileName}`
    downloadMode = 'local'
  } else {
    validateRelease(previous, version, fileName)
    metadata = { ...previous, sha256: previous.sha256.toUpperCase() }
    downloadUrl = validateDownloadUrl(externalOverride || metadata.downloadUrl)
    downloadMode = 'external'
  }

  // Clean only generated installer copies. The originals stay in the app's dist.
  for (const file of await readdir(downloads, { withFileTypes: true })) {
    if (
      file.isFile() &&
      /^Nudge-Setup-\d+\.\d+\.\d+(?:-[\w.-]+)?-x64\.exe$/.test(file.name) &&
      (downloadMode === 'external' || file.name !== fileName)
    ) {
      await unlink(join(downloads, file.name))
    }
  }
  const release = {
    ...metadata,
    size: `${(metadata.bytes / 1024 / 1024).toFixed(1)} MB`,
    downloadUrl,
    downloadMode
  }
  await writeFile(join(downloads, 'SHA256SUMS.txt'), `${release.sha256}  ${fileName}\n`)
  await writeFile(join(site, 'src', 'release.json'), JSON.stringify(release, null, 2) + '\n')
  return release
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const release = await prepareDownload({
    cloud: process.argv.includes('--cloud') || process.env.VERCEL === '1'
  })
  console.log(
    `Download ${release.downloadMode === 'local' ? 'bundled' : 'linked externally'}: ${release.fileName} (${release.size})`
  )
}
