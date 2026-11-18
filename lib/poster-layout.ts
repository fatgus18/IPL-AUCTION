/**
 * Split a portrait poster into balanced, ordered rows instead of leaving a
 * sparse final row. The quotient fills each row; the remainder adds one player
 * to the earliest rows, so no two rows differ by more than one player.
 *
 * Small squads share a single row. Larger squads use a near-square formation
 * with at least as many rows as columns, keeping the composition vertical.
 * All rows should use the same portrait width and center their own contents.
 */
export function getBalancedPosterRows(count: number): number[] {
  if (!Number.isInteger(count) || count < 0 || count > 30) {
    throw new RangeError("Poster player count must be an integer between 0 and 30.");
  }
  if (count === 0) return [];
  const rowCount = count <= 3 ? 1 : Math.ceil(Math.sqrt(count));
  const playersPerRow = Math.floor(count / rowCount);
  const extraPlayers = count % rowCount;
  return Array.from({ length: rowCount }, (_, index) => playersPerRow + (index < extraPlayers ? 1 : 0));
}
