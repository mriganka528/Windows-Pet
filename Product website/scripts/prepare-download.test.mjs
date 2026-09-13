import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { prepareDownload } from './prepare-download.mjs'

const cache = join(dirname(dirname(fileURLToPath(import.meta.url))), '.cache')
await mkdir(cache, { recursive: true })
const realCache = await realpath(cache)
const version = '0.1.1'
const fileName = `Nudge-Setup-${version}-x64.exe`
const payload = Buffer.alloc(1024 * 1024 + 256, 90)
const metadata = {
  version,
  fileName,
  bytes: payload.length,
  sha256: createHash('sha256').update(payload).digest('hex').toUpperCase(),
  downloadUrl: `https://github.com/mriganka528/Windows-Pet/releases/download/Nudge-Setup/${fileName}`
}

async function fixture(t) {
  const root = await mkdtemp(join(realCache, 'release-test-'))
  const site = join(root, 'Product website')
  await mkdir(site)
  await writeFile(join(root, 'package.json'), JSON.stringify({ version }))
  await writeFile(join(site, 'release.json'), JSON.stringify(metadata))
  t.after(async () => {
    const target = await realpath(root)
    assert.ok(target.startsWith(realCache + sep + 'release-test-'))
    await rm(target, { recursive: true, force: true })
  })
  return { root, site }
}

test('Vercel can build from a checkout with no Windows installer or build output', async (t) => {
  const { site } = await fixture(t)
  const release = await prepareDownload({ site, env: { VERCEL: '1' } })
  assert.equal(release.downloadMode, 'external')
  assert.equal(release.downloadUrl, metadata.downloadUrl)
  assert.equal(release.sha256, metadata.sha256)
  assert.deepEqual(await readdir(join(site, 'public/downloads')), ['SHA256SUMS.txt'])
  assert.equal(JSON.parse(await readFile(join(site, 'src/release.json'), 'utf8')).version, version)
})

test('local packaging preserves the supplied release tag and copies the exact installer', async (t) => {
  const { root, site } = await fixture(t)
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'dist', fileName), payload)
  const release = await prepareDownload({ site, env: {} })
  assert.equal(release.downloadMode, 'local')
  assert.equal(release.downloadUrl, `downloads/${fileName}`)
  assert.deepEqual(await readFile(join(site, 'public/downloads', fileName)), payload)
  const manifest = JSON.parse(await readFile(join(site, 'release.json'), 'utf8'))
  assert.deepEqual(manifest, metadata)
  // A cloud build on that same machine must exclude the large binary, too.
  const cloud = await prepareDownload({ site, env: {}, cloud: true })
  assert.equal(cloud.downloadMode, 'external')
  assert.deepEqual(await readdir(join(site, 'public/downloads')), ['SHA256SUMS.txt'])
  assert.deepEqual(await readFile(join(root, 'dist', fileName)), payload)
})

test('a public environment URL overrides the release host without changing the checksum', async (t) => {
  const { site } = await fixture(t)
  const url = `https://downloads.example.test/${fileName}?download=1&name=Windows%20Pet`
  const release = await prepareDownload({ site, env: { NUDGE_DOWNLOAD_URL: url } })
  assert.equal(release.downloadUrl, url)
  assert.equal(release.sha256, metadata.sha256)
})

test('stale release metadata cannot silently describe a different app version', async (t) => {
  const { root, site } = await fixture(t)
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.1.2' }))
  await assert.rejects(
    prepareDownload({ site, env: { VERCEL: '1' } }),
    /does not describe Nudge 0.1.2/
  )
})

test('missing, non-HTTPS, or credential-bearing download URLs fail with a useful error', async (t) => {
  const { site } = await fixture(t)
  await writeFile(join(site, 'release.json'), JSON.stringify({ ...metadata, downloadUrl: null }))
  await assert.rejects(
    prepareDownload({ site, env: { VERCEL: '1' } }),
    /public HTTPS installer URL/
  )
  for (const url of [
    'javascript:alert(1)',
    'http://example.test/setup.exe',
    'https://user:password@example.test/setup.exe'
  ]) {
    await assert.rejects(
      prepareDownload({ site, env: { NUDGE_DOWNLOAD_URL: url } }),
      /must use HTTPS/
    )
  }
})
