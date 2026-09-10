import { describe, expect, it } from 'vitest'
import { parseAudioLevel } from './audio'

describe('audio meter protocol', () => {
  it('accepts bounded levels and exposes only the numeric meter fields', () => {
    expect(
      parseAudioLevel('{"type":"audio-level","level":0.32,"available":true,"extra":"ignored"}\r')
    ).toEqual({ level: 0.32, available: true })
    expect(parseAudioLevel('{"type":"audio-level","level":0.7,"available":false}')).toEqual({
      level: 0,
      available: false
    })
  })
  it('rejects malformed, unrelated and unbounded packets', () => {
    for (const line of [
      'null',
      '[]',
      'not JSON',
      '{"type":"notification_closed"}',
      '{"type":"audio-level","level":-1,"available":true}',
      '{"type":"audio-level","level":2,"available":true}',
      '{"type":"audio-level","level":1e999,"available":true}',
      '{"type":"audio-level","level":"0.2","available":true}',
      '{"type":"audio-level","level":0.2,"available":1}'
    ])
      expect(parseAudioLevel(line)).toBeNull()
  })
})
