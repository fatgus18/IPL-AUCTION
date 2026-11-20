import type { SeasonAcquisition, SeasonTeam } from "./auction-season.ts";
import type { SeasonSourceSnapshot } from "./season-source.ts";

export const SEASON_RACE_LIMIT = 240;
export type SeasonRaceReason = SeasonAcquisition | "map";
export type SeasonRaceTeam = Pick<SeasonTeam, "id" | "name" | "shortName" | "color" | "manager" | "rank" | "points" | "knownPoints" | "matchedPlayers" | "totalPlayers" | "complete"> & {
  captainName: string | null; viceCaptainName: string | null;
};
type StoredSeasonRaceTeam = SeasonRaceTeam & {
  /** Fingerprints contain only public purchased-player identities and scoring assignments. */
  squadSignature: string; captaincySignature: string; coverageSignature: string;
};
export type SeasonRaceCheckpoint = {
  id: string; sequence: number; revision: number; roomVersion: number; recordedAt: number;
  sourceCapturedAt: string; reason: SeasonRaceReason; method: SeasonAcquisition;
  segmentId: string; sourceUrl: string; provider: SeasonSourceSnapshot["provider"];
  seriesId: string; seriesName: string; provisional: boolean; teams: StoredSeasonRaceTeam[];
};
export type StoredSeasonRaceHistory = {
  version: 1; totalCheckpoints: number; checkpoints: SeasonRaceCheckpoint[];
};
export type SeasonRaceTeamChange = {
  teamId: string; pointsDelta: number | null; rankDelta: number | null;
  squadChanged: boolean; captaincyChanged: boolean; coverageChanged: boolean; managerChanged: boolean;
};
export type SeasonRaceCheckpointView = Omit<SeasonRaceCheckpoint, "teams"> & {
  teams: SeasonRaceTeam[];
  previousCheckpointId: string | null; comparisonGap: boolean;
  teamChanges: SeasonRaceTeamChange[];
  /** A strict reversal of known scores. Joining or leaving a tie is not an overtake. */
  overtakes: { teamId: string; passedTeamId: string }[];
};
export type SeasonRaceHistory = {
  checkpoints: SeasonRaceCheckpointView[]; totalCheckpoints: number; omittedCheckpoints: number;
  limit: number; currentSegmentId: string | null; currentTeamsChanged: boolean;
};

// A compact deterministic fingerprint; its input is exclusively already-public squad data.
function fingerprint(value: unknown): string {
  let hash = BigInt("14695981039346656037");
  for (const character of JSON.stringify(value)) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * BigInt("1099511628211"));
  }
  return hash.toString(16).padStart(16, "0");
}

function freezeTeam(team: SeasonTeam): StoredSeasonRaceTeam {
  const players = [...team.players].sort((a, b) => a.id.localeCompare(b.id));
  return {
    id: team.id, name: team.name, shortName: team.shortName, color: team.color, manager: team.manager,
    rank: team.rank, points: team.points, knownPoints: team.knownPoints, matchedPlayers: team.matchedPlayers,
    totalPlayers: team.totalPlayers, complete: team.complete,
    captainName: players.find(player => player.captain)?.name ?? null,
    viceCaptainName: players.find(player => player.viceCaptain)?.name ?? null,
    squadSignature: fingerprint(players.map(player => player.id)),
    captaincySignature: fingerprint(players.filter(player => player.multiplier !== 1).map(player => [player.id, player.multiplier])),
    coverageSignature: fingerprint(players.map(player => [player.id, player.sourceKey])),
  };
}

function publicTeam(team: StoredSeasonRaceTeam): SeasonRaceTeam {
  return {
    id: team.id, name: team.name, shortName: team.shortName, color: team.color, manager: team.manager,
    rank: team.rank, points: team.points, knownPoints: team.knownPoints, matchedPlayers: team.matchedPlayers,
    totalPlayers: team.totalPlayers, complete: team.complete, captainName: team.captainName, viceCaptainName: team.viceCaptainName,
  };
}

function sameSource(a: Pick<SeasonRaceCheckpoint, "provider" | "seriesId" | "sourceUrl">, b: Pick<SeasonSourceSnapshot, "provider" | "seriesId" | "sourceUrl">): boolean {
  return a.provider === b.provider && a.seriesId === b.seriesId && a.sourceUrl === b.sourceUrl;
}

/** Call only inside the successful season write transaction, using its freshly read room. */
export function appendSeasonRaceCheckpoint(
  history: StoredSeasonRaceHistory | undefined,
  snapshot: SeasonSourceSnapshot,
  teams: readonly SeasonTeam[],
  metadata: { revision: number; roomVersion: number; recordedAt: number; reason: SeasonRaceReason; method: SeasonAcquisition; provisional: boolean },
): StoredSeasonRaceHistory {
  const previous = history?.checkpoints.at(-1);
  const sequence = (history?.totalCheckpoints ?? 0) + 1;
  const checkpoint: SeasonRaceCheckpoint = {
    id: `refresh-${sequence}`, sequence, ...metadata,
    sourceCapturedAt: snapshot.fetchedAt, sourceUrl: snapshot.sourceUrl, provider: snapshot.provider,
    seriesId: snapshot.seriesId, seriesName: snapshot.seriesName,
    segmentId: previous && sameSource(previous, snapshot) ? previous.segmentId : `series-${sequence}`,
    teams: teams.map(freezeTeam),
  };
  const checkpoints = [...(history?.checkpoints ?? []), checkpoint];
  return { version: 1, totalCheckpoints: sequence, checkpoints: checkpoints.length > SEASON_RACE_LIMIT
    ? [checkpoints[0], ...checkpoints.slice(-(SEASON_RACE_LIMIT - 1))] : checkpoints };
}

function changes(previous: readonly StoredSeasonRaceTeam[], current: readonly StoredSeasonRaceTeam[], sum: (values: readonly number[]) => number): SeasonRaceTeamChange[] {
  const before = new Map(previous.map(team => [team.id, team]));
  return current.map(team => {
    const old = before.get(team.id);
    return {
      teamId: team.id,
      pointsDelta: old && old.points !== null && team.points !== null ? sum([team.points, -old.points]) : null,
      rankDelta: old?.rank != null && team.rank !== null ? old.rank - team.rank : null,
      squadChanged: !!old && old.squadSignature !== team.squadSignature,
      captaincyChanged: !!old && old.captaincySignature !== team.captaincySignature,
      coverageChanged: !!old && old.coverageSignature !== team.coverageSignature,
      managerChanged: !!old && old.manager !== team.manager,
    };
  });
}

/** Pure public projection: reading or changing the current room never adds or rewrites history. */
export function deriveSeasonRaceHistory(
  history: StoredSeasonRaceHistory | undefined,
  currentTeams: readonly SeasonTeam[],
  sum: (values: readonly number[]) => number,
): SeasonRaceHistory {
  const stored = history?.checkpoints ?? [];
  const checkpoints = stored.map((checkpoint, index): SeasonRaceCheckpointView => {
    const candidate = stored[index - 1];
    const comparisonGap = !!candidate && checkpoint.sequence !== candidate.sequence + 1;
    const previous = candidate?.segmentId === checkpoint.segmentId && !comparisonGap ? candidate : null;
    const before = new Map(previous?.teams.map(team => [team.id, team]) ?? []);
    const overtakes: SeasonRaceCheckpointView["overtakes"] = [];
    if (previous) for (const team of checkpoint.teams) {
      const old = before.get(team.id);
      if (team.points === null || old?.points == null) continue;
      for (const other of checkpoint.teams) {
        const oldOther = before.get(other.id);
        if (other.id !== team.id && other.points !== null && oldOther?.points != null
          && old.points < oldOther.points && team.points > other.points) overtakes.push({ teamId: team.id, passedTeamId: other.id });
      }
    }
    return {
      ...checkpoint, teams: checkpoint.teams.map(publicTeam),
      previousCheckpointId: previous?.id ?? null, comparisonGap,
      teamChanges: previous ? changes(previous.teams, checkpoint.teams, sum) : [], overtakes,
    };
  });
  const latest = stored.at(-1);
  const current = currentTeams.map(freezeTeam);
  const before = new Map(latest?.teams.map(team => [team.id, team]) ?? []);
  const currentTeamsChanged = !!latest && (latest.teams.length !== current.length || current.some(team => {
    const old = before.get(team.id);
    return !old || old.squadSignature !== team.squadSignature || old.captaincySignature !== team.captaincySignature
      || old.coverageSignature !== team.coverageSignature || old.manager !== team.manager || old.points !== team.points;
  }));
  return {
    checkpoints, totalCheckpoints: history?.totalCheckpoints ?? 0,
    omittedCheckpoints: Math.max(0, (history?.totalCheckpoints ?? 0) - checkpoints.length),
    limit: SEASON_RACE_LIMIT, currentSegmentId: latest?.segmentId ?? null, currentTeamsChanged,
  };
}
