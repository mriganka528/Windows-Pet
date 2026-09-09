import { describe, it, expect } from 'vitest'
import { webcamInUseFromRegQuery } from './webcamWatcher'

// ---------------------------------------------------------------------------
// The pure ConsentStore parser is the heart of webcam detection, and it's the
// one piece we can exercise without Windows, a registry, or a camera. These
// cases pin the rule: an app is LIVE when it has a non-zero LastUsedTimeStart
// and a LastUsedTimeStop of exactly 0 (Windows zeroes the stop for the duration
// of a session), grouped per-subkey so one app's Start can't pair with another's
// zero Stop.
// ---------------------------------------------------------------------------

/** A realistic `reg query <key> /s` fragment for one app subkey. */
function appBlock(path: string, startHex: string, stopHex: string): string {
  return [
    `HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\NonPackaged\\${path}`,
    `    LastUsedTimeStart    REG_QWORD    ${startHex}`,
    `    LastUsedTimeStop    REG_QWORD    ${stopHex}`
  ].join('\r\n')
}

describe('webcamInUseFromRegQuery', () => {
  it('returns false for empty output (no camera, missing key, or reg failure)', () => {
    expect(webcamInUseFromRegQuery('')).toBe(false)
  })

  it('detects a live session: a non-zero Start with a zero Stop', () => {
    const out = appBlock('C:#Apps#Zoom.exe', '0x1d9abcdef012345', '0x0')
    expect(webcamInUseFromRegQuery(out)).toBe(true)
  })

  it('treats a released app (non-zero Stop) as not in use', () => {
    const out = appBlock('C:#Apps#Zoom.exe', '0x1d9abcdef012345', '0x1d9abcf00000000')
    expect(webcamInUseFromRegQuery(out)).toBe(false)
  })

  it('returns true when ANY app is live among several released ones', () => {
    const out = [
      appBlock('C:#Apps#Teams.exe', '0x1d9aaa', '0x1d9bbb'), // released
      appBlock('C:#Apps#Zoom.exe', '0x1d9ccc', '0x0'), // live
      appBlock('C:#Apps#Skype.exe', '0x1d9ddd', '0x1d9eee') // released
    ].join('\r\n')
    expect(webcamInUseFromRegQuery(out)).toBe(true)
  })

  it('does not pair one app Start with another app zero Stop (per-subkey grouping)', () => {
    // App A has only a (non-zero) Start; App B has only a zero Stop. Neither is a
    // live session on its own, and they must not be combined into a false positive.
    const out = [
      'HKEY_CURRENT_USER\\...\\webcam\\NonPackaged\\A.exe',
      '    LastUsedTimeStart    REG_QWORD    0x1d9abc',
      'HKEY_CURRENT_USER\\...\\webcam\\NonPackaged\\B.exe',
      '    LastUsedTimeStop    REG_QWORD    0x0'
    ].join('\r\n')
    expect(webcamInUseFromRegQuery(out)).toBe(false)
  })

  it('ignores non-QWORD rows and a zero Start (app that never used the camera)', () => {
    const out = [
      'HKEY_CURRENT_USER\\...\\webcam\\NonPackaged\\Never.exe',
      '    (Default)    REG_SZ    (value not set)',
      '    LastUsedTimeStart    REG_QWORD    0x0',
      '    LastUsedTimeStop    REG_QWORD    0x0'
    ].join('\r\n')
    // Start is 0 -> the app has never opened the camera -> not live.
    expect(webcamInUseFromRegQuery(out)).toBe(false)
  })
})
