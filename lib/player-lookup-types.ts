/** Public API contract. Unknown statistics are null, never invented zeroes. */
export type LookupRole = "Batter" | "Bowler" | "All-rounder" | "Wicketkeeper";
export type LookupStats = { matches: number | null; runs: number | null; wickets: number | null; strikeRate: number | null };
export type LookupCandidate = {
  id: string;
  name: string;
  country: string | null;
  dateOfBirth: string | null;
  image: string | null;
  profileUrl: string;
  provider: "Cricbuzz" | "ESPNcricinfo" | "Local catalog";
};
export type LookupPlayer = LookupCandidate & {
  role: LookupRole | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
  stats: LookupStats;
  statsFormat: "IPL" | "T20I" | "T20" | "ODI" | "Test" | null;
  statsScope: "career";
  /** Fetch timestamp; the provider's underlying data may have a different update cadence. */
  fetchedAt: string;
  sourceUrls: string[];
  missingFields: string[];
  warnings: string[];
  /** Organizer-editable starting price in lakhs. This is not a market valuation. */
  basePriceSuggested: number;
};
export type PlayerLookupResult = {
  status: "found" | "candidates" | "not_found";
  player?: LookupPlayer;
  candidates: LookupCandidate[];
  warnings: string[];
  cached: boolean;
};
