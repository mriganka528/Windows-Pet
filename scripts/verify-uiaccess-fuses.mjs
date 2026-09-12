import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const [executable, builderCli] = process.argv.slice(2)
if (!executable || !builderCli)
  throw new Error('Pass the executable and electron-builder CLI paths.')
const require = createRequire(resolve(builderCli))
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses')
const { FuseState } = require('@electron/fuses/dist/constants.js')
const wire = await getCurrentFuseWire(resolve(executable))
const expected = {
  RunAsNode: FuseState.DISABLE,
  EnableNodeOptionsEnvironmentVariable: FuseState.DISABLE,
  EnableNodeCliInspectArguments: FuseState.DISABLE,
  EnableEmbeddedAsarIntegrityValidation: FuseState.ENABLE,
  OnlyLoadAppFromAsar: FuseState.ENABLE
}
for (const [option, state] of Object.entries(expected)) {
  if (wire[FuseV1Options[option]] !== state) throw new Error(`Unsafe UIAccess fuse: ${option}`)
}
console.log(
  'Verified: app.asar integrity required; Node environment and debugger entry points disabled.'
)
