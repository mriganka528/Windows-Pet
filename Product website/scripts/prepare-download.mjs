import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = dirname(dirname(fileURLToPath(import.meta.url)))
const workspace = dirname(site)
const { version } = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8'))
const fileName = `Nudge-Setup-${version}-x64.exe`
const installer = join(workspace, 'dist', fileName)
let info
try {
  info = await stat(installer)
} catch {
  throw new Error(
    `Build the Windows app first: npm.cmd run dist:win in the parent folder. Missing ${installer}`
  )
}
if (!info.isFile() || info.size < 1024 * 1024)
  throw new Error('The installer is missing or incomplete.')
async function digest(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex').toUpperCase()
}
const sha256 = await digest(installer)
const downloads = join(site, 'public', 'downloads')
await mkdir(downloads, { recursive: true })
await mkdir(join(site, 'src'), { recursive: true })
const target = join(downloads, fileName)
const targetStat = await stat(target).catch(() => null)
if (!targetStat || targetStat.size !== info.size || (await digest(target)) !== sha256) {
  await copyFile(installer, target)
}
await writeFile(join(downloads, 'SHA256SUMS.txt'), `${sha256}  ${fileName}\n`)
await writeFile(
  join(site, 'src', 'release.json'),
  JSON.stringify(
    {
      version,
      fileName,
      bytes: info.size,
      size: `${(info.size / 1024 / 1024).toFixed(1)} MB`,
      sha256
    },
    null,
    2
  ) + '\n'
)
console.log(`Download ready: ${fileName} (${(info.size / 1024 / 1024).toFixed(1)} MB)`)

// This generated website directory ships the current release. Previous builds
// remain in the parent app's dist folder, rather than doubling the site's size.
for (const file of await readdir(downloads, { withFileTypes: true })) {
  if (
    file.isFile() &&
    file.name !== fileName &&
    /^Nudge-Setup-\d+\.\d+\.\d+-x64\.exe$/.test(file.name)
  ) {
    await unlink(join(downloads, file.name))
  }
}
