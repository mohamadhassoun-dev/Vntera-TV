/**
 * Whether the player's cinema surface turns the picture ninety degrees.
 *
 * Cinema mode follows the handset, so an upright phone gets a landscape picture;
 * the rotate control overrides that either way, and the override is dropped when
 * cinema mode ends so the next entry follows the handset again.
 */
export function pictureTurned(
  cinema: boolean,
  turnOverride: boolean | null,
  portrait: boolean,
): boolean {
  return cinema && (turnOverride ?? portrait)
}
