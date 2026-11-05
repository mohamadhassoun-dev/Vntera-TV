import { describe, expect, it } from 'vitest'
import { pictureTurned } from './playerLayout'

describe('player cinema rotation', () => {
  it('never turns the picture outside cinema mode', () => {
    expect(pictureTurned(false, null, true)).toBe(false)
    expect(pictureTurned(false, true, false)).toBe(false)
  })

  it('turns an upright handset and leaves a landscape one alone', () => {
    expect(pictureTurned(true, null, true)).toBe(true)
    expect(pictureTurned(true, null, false)).toBe(false)
  })

  it('lets the rotate control turn the picture regardless of how the phone is held', () => {
    expect(pictureTurned(true, true, false)).toBe(true)
    expect(pictureTurned(true, false, true)).toBe(false)
  })

  it('toggles: the rotate control always flips what is on screen', () => {
    // Portrait handset, cinema mode, then one tap of the rotate control.
    const before = pictureTurned(true, null, true)
    const after = pictureTurned(true, !before, true)
    expect(before).toBe(true)
    expect(after).toBe(false)
    expect(pictureTurned(true, !after, true)).toBe(true)
  })
})
