import reference from "../data/season-reference-2026.json" with { type: "json" };
import { validateSeasonSourceUrl, type SeasonSourceSnapshot } from "./season-source.ts";

/** A dated, verified provider capture. Loading it is always an explicit creator action. */
export const SEASON_REFERENCE_METADATA = Object.freeze({
  sourceUrl: reference.sourceUrl,
  seriesId: reference.seriesId,
  seriesName: reference.seriesName,
  fetchedAt: reference.fetchedAt,
  playerCount: reference.rows.length,
});

/** Never substitutes a different season, invents freshness, or shares mutable room data. */
export function getSeasonReference(sourceUrl: string): SeasonSourceSnapshot | null {
  try {
    if (validateSeasonSourceUrl(sourceUrl).seriesId !== reference.seriesId) return null;
  } catch { return null; }
  return structuredClone(reference) as SeasonSourceSnapshot;
}
