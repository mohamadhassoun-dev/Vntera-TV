import { describe, expect, it } from 'vitest'
import { episodeDurationLabel } from './episodeDuration'

describe('episode duration badge', () => {
  it('shows the length the panel sends', () => {
    expect(episodeDurationLabel('00:55:57', 3357)).toBe('00:55:57')
    expect(episodeDurationLabel('55:57', undefined)).toBe('55:57')
  })

  it('treats a zero timecode as no length', () => {
    expect(episodeDurationLabel('00:00:00')).toBe('')
    expect(episodeDurationLabel('0:00:00')).toBe('')
    expect(episodeDurationLabel('00:00:00.000')).toBe('')
  })

  it('treats a missing length as no length', () => {
    expect(episodeDurationLabel(undefined)).toBe('')
    expect(episodeDurationLabel(null, 0)).toBe('')
    expect(episodeDurationLabel('')).toBe('')
    expect(episodeDurationLabel('   ')).toBe('')
  })

  it('falls back to seconds when the text is absent or zero', () => {
    // formatTimecode drops an empty hour, which is what the rest of the app shows.
    expect(episodeDurationLabel(undefined, 3357)).toBe('55:57')
    expect(episodeDurationLabel('00:00:00', 90)).toBe('1:30')
  })
})
