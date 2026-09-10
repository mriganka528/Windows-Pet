import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = join(root, 'out', 'watcher', 'win-x64')
if (process.platform !== 'win32') throw new Error('Build the Windows installer on Windows.')

const result = spawnSync(
  'dotnet',
  [
    'publish',
    join(root, 'native', 'NudgeWatcher', 'NudgeWatcher.csproj'),
    '--configuration',
    'Release',
    '--runtime',
    'win-x64',
    '--self-contained',
    'true',
    '--output',
    output,
    '--nologo',
    '-p:PublishSingleFile=false',
    '-p:PublishTrimmed=false',
    '-p:DebugType=None',
    '-p:DebugSymbols=false'
  ],
  { stdio: 'inherit', shell: false, windowsHide: true, cwd: root }
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

for (const file of [
  'NudgeWatcher.exe',
  'NudgeWatcher.dll',
  'NudgeWatcher.runtimeconfig.json',
  'coreclr.dll',
  'hostfxr.dll',
  'hostpolicy.dll',
  'System.Private.CoreLib.dll',
  'UIAutomationClient.dll',
  'UIAutomationTypes.dll',
  'Microsoft.Windows.SDK.NET.dll',
  'WinRT.Runtime.dll'
]) {
  if (!existsSync(join(output, file)))
    throw new Error(`Incomplete native publish: ${file} is missing`)
}
const runtime = JSON.parse(
  readFileSync(join(output, 'NudgeWatcher.runtimeconfig.json'), 'utf8')
).runtimeOptions
if (runtime.framework || runtime.frameworks || !runtime.includedFrameworks?.length) {
  throw new Error(
    'Native publish still depends on an installed .NET runtime; refusing to package it.'
  )
}
console.log(`Self-contained Windows helper ready: ${output}`)
