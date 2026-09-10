/** The only audio data crossing the bridge: an output level, never samples. */
export interface AudioLevel {
  level: number
  available: boolean
}

export function parseAudioLevel(line: string): AudioLevel | null {
  try {
    const data = JSON.parse(line) as Record<string, unknown> | null
    if (
      !data ||
      data.type !== 'audio-level' ||
      typeof data.available !== 'boolean' ||
      typeof data.level !== 'number' ||
      !Number.isFinite(data.level) ||
      data.level < 0 ||
      data.level > 1
    )
      return null
    return { level: data.available ? data.level : 0, available: data.available }
  } catch {
    return null
  }
}
