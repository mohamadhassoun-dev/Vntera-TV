import type { ProgressEntry } from '../types'
import { useLibrary } from '../store/library'

/** Synchronous map for card overlays; reading the store directly avoids a
 *  subscription per card during long-rail renders. */
export function loadProgressMap(): Record<string, ProgressEntry> {
  return useLibrary.getState().progress
}
