import { describe, expect, it } from 'vitest'
import type { NotificationItem, Title } from '../types'
import { alertTitleKey, dedupeNotifications, notificationKey, takeUnannounced } from './notifications'

function note(id: string, title: string, kind: NotificationItem['kind'] = 'content'): NotificationItem {
  return { id, kind, title, body: '', createdAt: 0, read: false }
}

function series(id: number, name: string, overrides: Partial<Title> = {}): Title {
  return {
    key: `series:${id}`,
    kind: 'series',
    id,
    name,
    cleanName: name.toLowerCase(),
    genres: [],
    cast: [],
    quality: 'HD',
    languages: ['ar'],
    editions: [],
    categoryId: 'series',
    categoryName: 'Series',
    addedAt: id,
    provider: 'other',
    hasArtwork: true,
    ...overrides,
  }
}

describe('notification centre', () => {
  it('treats the same headline as one notification and keeps the newest', () => {
    const items = [
      note('a', 'New series: دافئته سوا (2026)'),
      note('b', 'New series: دافئته سوا (2026)'),
      note('c', 'New movie: Aliens (1986)'),
    ]
    expect(dedupeNotifications(items).map((n) => n.id)).toEqual(['a', 'c'])
    expect(notificationKey(note('x', '  New Series: X  '))).toBe(notificationKey(note('y', 'new series: x')))
  })

  it('recognises a re-indexed title as the same show', () => {
    // Same series, new stream id and a quality tag the panel added on re-index.
    const first = series(41, 'دافئته سوا (2026)')
    const again = series(999, 'دافئته سوا (2026) 1080p')
    expect(alertTitleKey(first)).toBe(alertTitleKey(again))
    expect(alertTitleKey(series(41, 'دافئته سوا (2026)'))).not.toBe(alertTitleKey(series(41, 'دافئته سوا (2026)', { kind: 'movie' })))
  })

  it('announces each title once, even when a batch repeats it', () => {
    const seen = new Set<string>()
    const batch = [series(1, 'أحلى نصيب (2026)'), series(2, 'أحلى نصيب (2026)'), series(3, 'حب أسود (2026)')]
    const first = takeUnannounced(batch, seen, 4)
    expect(first.map((t) => t.id)).toEqual([1, 3])
    // A later catalogue pull with fresh ids for the same shows stays quiet.
    expect(takeUnannounced([series(7, 'أحلى نصيب (2026)')], seen, 4)).toEqual([])
  })
})
