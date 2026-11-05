import type { NotificationItem, Title } from '../types'
import { titleIdentity } from './homeRotation'

/**
 * Two notifications that name the same thing are one notification. The centre was
 * filling with the same series twice because the panel lists one show under several
 * stream ids and re-indexes them over time, and every new id read as "new".
 */
export function notificationKey(item: Pick<NotificationItem, 'kind' | 'title'>): string {
  return `${item.kind}|${item.title.trim().toLowerCase()}`
}

/** Newest first, one entry per notification key. */
export function dedupeNotifications(items: readonly NotificationItem[]): NotificationItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = notificationKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Identity of a title for alert purposes: the same movie or series announced once
 * stays announced even after the panel hands it a new stream id.
 */
export function alertTitleKey(title: Title): string {
  return `${title.kind}:${titleIdentity(title)}`
}

/** Keep only titles this profile has not been told about yet, marking them seen. */
export function takeUnannounced(
  titles: readonly Title[],
  seen: Set<string>,
  limit = Number.POSITIVE_INFINITY,
): Title[] {
  const picked: Title[] = []
  for (const title of titles) {
    if (picked.length >= limit) break
    const key = alertTitleKey(title)
    if (seen.has(key)) continue
    seen.add(key)
    picked.push(title)
  }
  return picked
}
