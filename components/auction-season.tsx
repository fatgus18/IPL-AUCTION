"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleAlert, Crown, FileSpreadsheet, Link2, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, Target, Trophy, Users, X } from "lucide-react";
import type { RoomState } from "@/lib/auction";
import type { AuctionSeasonView, SeasonPlayer, SeasonTeam } from "@/lib/auction-season";
import type { SeasonStatRow } from "@/lib/season-analytics";
import { requestAuction } from "@/lib/auction-client";
import { formatMoney } from "@/lib/auction-display";
import { PlayerImage, TeamCrest } from "./ipl-visuals";
import { SeasonAnalytics } from "./season-analytics";
import { SeasonRaceTimeline } from "./season-race";
import "./auction-season.css";

type Props = { state: RoomState; token: string; memberId: string; isCreator: boolean; connected: boolean; ownTeamId?: string };
type SeasonResponse = { season: AuctionSeasonView };
type Operation = "configure" | "fetch" | "import" | "reference" | "map" | "export" | null;
const DEFAULT_SOURCE = "https://www.espncricinfo.com/series/ipl-2026-1510719/most-valuable-players";
const pointFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 7 });
const points = (value: number | null | undefined) => value == null ? "—" : pointFormat.format(value);
const dateTime = (value: number | string) => new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The season could not be updated. Please try again.";

/** Room polling supplies purchases; this page reads saved season data, never the provider, automatically. */
export function AuctionSeason({ state, token, memberId, isCreator, connected, ownTeamId }: Props) {
  const [season, setSeason] = useState<AuctionSeasonView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<Operation>(null);
  const [sourceDraft, setSourceDraft] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>({});
  const [mappingSearch, setMappingSearch] = useState("");
  const seasonRef = useRef<AuctionSeasonView | null>(null);
  const readController = useRef<AbortController | null>(null);
  const operationController = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sourceId = useId();
  const importId = useId();
  const api = `/api/rooms/${encodeURIComponent(state.code)}/season`;
  const canManage = isCreator && season?.canManage === true;
  const sourceUrl = sourceDraft ?? season?.sourceUrl ?? DEFAULT_SOURCE;
  const sourceDirty = !!season && sourceUrl.trim() !== season.sourceUrl;
  const workerMode = season?.sourceFetch?.mode === "worker";
  const cloudMode = season?.sourceFetch?.mode === "cloud";
  const refreshOffline = (workerMode || cloudMode) && !season?.sourceFetch?.available;
  const disabled = !connected || !!busy || !season;

  const accept = useCallback((next: AuctionSeasonView) => {
    const previous = seasonRef.current;
    if (previous && (next.revision < previous.revision || (next.revision === previous.revision && next.roomVersion < previous.roomVersion))) return;
    seasonRef.current = next;
    setSeason(next);
    setLoadError("");
  }, []);

  const readSeason = useCallback(async () => {
    if (readController.current || operationController.current) return;
    const controller = new AbortController();
    readController.current = controller;
    try {
      const response = await requestAuction<SeasonResponse>(api, undefined, token, { signal: controller.signal });
      if (!controller.signal.aborted) accept(response.season);
    } catch (error) { if (!controller.signal.aborted) setLoadError(errorMessage(error)); }
    finally { if (readController.current === controller) readController.current = null; }
  }, [api, token, accept]);

  // Bid/chat ticks do not trigger extra season requests. Saved purchases and captaincy do.
  const resultSignature = JSON.stringify([state.endedAt, state.resultsRevision, state.teams.map(team => [team.id, team.squad, team.lineup?.revision]), state.members.map(member => [member.id, member.name, member.teamId])]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!document.hidden && connected) await readSeason();
      if (!stopped) timer = setTimeout(poll, 15000);
    };
    const visible = () => { if (!document.hidden && connected) void readSeason(); };
    timer = setTimeout(poll, 250);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      stopped = true; clearTimeout(timer);
      readController.current?.abort("navigation"); readController.current = null;
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, [connected, readSeason, resultSignature]);

  useEffect(() => () => { operationController.current?.abort("navigation"); operationController.current = null; }, [token, memberId]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (selectedTeamId && dialog && !dialog.open) dialog.showModal();
    else if (!selectedTeamId && dialog?.open) dialog.close();
  }, [selectedTeamId]);

  async function mutate(type: Exclude<Operation, "export" | null>, extra: Record<string, unknown> = {}) {
    if (operationController.current || !connected || !seasonRef.current || !canManage) return;
    if (type === "reference" && sourceDirty) return;
    if (type === "fetch" && refreshOffline) return;
    const controller = new AbortController(); operationController.current = controller;
    readController.current?.abort(); readController.current = null;
    setBusy(type); setActionError(""); setNotice("");
    try {
      let current = seasonRef.current;
      if ((type === "fetch" || type === "import") && sourceUrl.trim() !== current.sourceUrl) {
        const configured = await requestAuction<SeasonResponse>(api, { type: "configure", sourceUrl: sourceUrl.trim(), expectedRevision: current.revision }, token, { signal: controller.signal });
        current = configured.season; accept(current); setSourceDraft(null);
      }
      const response = await requestAuction<SeasonResponse>(api, { type, ...extra, expectedRevision: current.revision }, token, { signal: controller.signal, timeoutMs: 45000 });
      if (controller.signal.aborted) return;
      accept(response.season);
      if (type === "configure") setSourceDraft(null);
      if (type === "import") setImportText("");
      if (type === "map") setMappingDrafts({});
      setNotice(type === "configure" ? "Source link saved. Existing points stay available until you fetch or import new data." : type === "fetch" ? "Latest season data saved for everyone in this room." : type === "import" ? "Imported points saved. Standings are up to date." : type === "reference" ? "Verified snapshot loaded. Its original capture date is shown below; this is not a live refresh." : "Player match saved. Standings have been recalculated.");
    } catch (error) {
      if (!controller.signal.aborted) setActionError(errorMessage(error));
    } finally {
      if (operationController.current === controller) {
        operationController.current = null; setBusy(null);
        if (!controller.signal.aborted) void readSeason();
      }
    }
  }

  async function download() {
    if (operationController.current || disabled || !season?.snapshot) return;
    const controller = new AbortController(); operationController.current = controller;
    setBusy("export"); setActionError("");
    const timer = setTimeout(() => controller.abort("timeout"), 45000);
    try {
      const response = await fetch(`${api}/export`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) throw new Error("The season workbook could not be downloaded. Please try again.");
      const blob = await response.blob();
      if (controller.signal.aborted || !blob.size) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `Pavilion-${state.code}-season.xlsx`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) { if (controller.signal.reason !== "navigation") setActionError(controller.signal.aborted ? "The download took too long. Please try again." : errorMessage(error)); }
    finally { clearTimeout(timer); if (operationController.current === controller) { operationController.current = null; setBusy(null); } }
  }

  function mapPlayer(playerId: string, sourceKey: string) {
    if (!season || !sourceKey) return;
    const mappings = Object.fromEntries(Object.entries(season.mappings).filter(([, id]) => id !== playerId));
    mappings[sourceKey] = playerId;
    void mutate("map", { mappings });
  }

  const performers = useMemo(() => season?.teams.flatMap(team => team.players.filter(player => player.points !== null).map(player => ({ player, team }))).sort((a, b) => (b.player.points ?? 0) - (a.player.points ?? 0) || a.player.name.localeCompare(b.player.name)).slice(0, 3) ?? [], [season]);
  const rankedTeams = season?.teams.filter(team => team.totalPlayers > 0) ?? [];
  const leader = rankedTeams.find(team => team.rank === 1) ?? rankedTeams.find(team => team.matchedPlayers > 0);
  const leadingPlayer = performers[0];
  const selectedTeam = season?.teams.find(team => team.id === selectedTeamId);
  const selectedRate = season?.analytics?.boards.find(board => board.id === "points-per-match")?.rows.find(row => row.teamId === selectedTeamId);
  const ownTeam = season?.teams.find(team => team.id === ownTeamId);
  const maxPoints = Math.max(1, ...rankedTeams.map(team => Math.abs(team.knownPoints)));
  const unmapped = season?.unmatchedPlayers.filter(player => `${player.name} ${player.teamName}`.toLowerCase().includes(mappingSearch.toLowerCase())) ?? [];
  const activeTeams = season?.teams.filter(team => team.manager !== "No manager assigned" || team.totalPlayers > 0).length ?? 0;

  return <section className="auction-season" aria-labelledby="auction-season-heading">
    <header className="season-heading">
      <div><span className="season-eyebrow"><span/>THE SEASON DESK</span><h1 id="auction-season-heading">Auction <em>season.</em></h1><p>{state.name}</p></div>
      <div className="season-heading-actions"><span className={`season-status ${season?.provisional !== false ? "is-provisional" : ""}`}><ShieldCheck size={15}/>{season?.provisional !== false ? "Provisional squads" : "Auction complete"}</span><button className="season-button season-button-secondary" disabled={disabled || !season?.snapshot} onClick={() => void download()}><FileSpreadsheet size={18}/>{busy === "export" ? "Preparing…" : "Download points"}<ArrowDownToLine size={15}/></button></div>
    </header>

    <div className="season-rules"><span><Users size={17}/>All signings count</span><span><b>C</b>Captain 2×</span><span><b>VC</b>Vice captain 1.5×</span><span>Uses saved squads and captaincy</span></div>

    {(actionError || loadError) && <div className="season-message season-message-error" role="alert"><CircleAlert size={20}/><div><strong>{actionError || loadError}</strong>{season?.snapshot && <span>Your last successful points snapshot is still available below.</span>}</div>{!actionError && <button className="season-text-button" onClick={() => void readSeason()} disabled={!connected}>Retry</button>}</div>}
    {notice && <div className="season-message season-message-success" role="status"><Check size={19}/><span>{notice}</span><button className="season-icon-button" aria-label="Dismiss season notification" onClick={() => setNotice("")}><X size={17}/></button></div>}
    {season?.sourceChanged && <div className="season-message" role="status"><CircleAlert size={19}/><span>The source link changed. These standings still use the last successful source until new data is fetched.</span></div>}

    {!season && !loadError ? <div className="season-loading" role="status"><LoaderCircle size={26}/><strong>Opening the season desk…</strong></div> : <>
      <div className="season-spotlights">
        <article className={`season-leader-card${leader ? " has-leader" : ""}`} style={{ "--season-team": leader?.color ?? "#d9b777" } as CSSProperties}>
          <div className="season-leader-orbit" aria-hidden="true"/>
          {leader && <div className="season-leader-watermark" aria-hidden="true"><TeamCrest team={leader}/></div>}
          <div className="season-card-label"><Trophy size={17}/>{leader ? "SETTING THE PACE" : "THE NEXT CHAPTER"}</div>
          {leader ? <><div className="season-leading-team"><TeamCrest key={leader.id} team={leader}/><div><h2>{leader.name}</h2><p>{leader.manager}</p></div></div><div className="season-leader-score"><strong>{points(leader.points ?? leader.knownPoints)}</strong><span>{leader.complete ? "season points" : "known points · partial"}</span></div><button className="season-text-button" onClick={() => setSelectedTeamId(leader.id)}>Explore the squad<ArrowRight size={17}/></button></> : <><h2>Your auction.<br/><em>A whole new innings.</em></h2><p className="season-leader-intro">Follow every signing from the auction table to the season leaderboard.</p><span className="season-waiting-label"><Target size={17}/>{season?.snapshot ? "Waiting for matched signings" : isCreator ? "Connect a points source to begin" : "Waiting for the creator to add points"}</span></>}
        </article>
        <article className="season-player-spotlight">
          <div className="season-card-label"><Sparkles size={17}/>BIGGEST CONTRIBUTION</div>
          {leadingPlayer ? <><div className="season-spotlight-photo" aria-hidden="true"><span className="season-spotlight-ring"/><PlayerImage player={leadingPlayer.player}/></div><div className="season-spotlight-copy"><span className="season-player-franchise"><TeamCrest team={leadingPlayer.team}/>{leadingPlayer.team.shortName}{leadingPlayer.player.captain && <b>C · 2×</b>}{leadingPlayer.player.viceCaptain && <b>VC · 1.5×</b>}</span><h2>{leadingPlayer.player.name}</h2><strong>{points(leadingPlayer.player.points)}<small>points</small></strong><span>{points(leadingPlayer.player.rawPoints)} MVP × {leadingPlayer.player.multiplier}</span></div></> : <div className="season-spotlight-empty"><Trophy size={58} strokeWidth={1}/><h2>Every signing<br/>has a story.</h2><p>Top performers appear when season points are available.</p></div>}
        </article>
      </div>

      <div className="season-summary-strip"><div><span>Franchises</span><strong>{activeTeams.toString().padStart(2, "0")}</strong></div><div><span>Players with points</span><strong>{season?.coverage.matchedPlayers ?? 0}<small> / {season?.coverage.totalPlayers ?? 0}</small></strong></div><div><span>{ownTeam ? "Your points" : "Scoring"}</span><strong>{ownTeam ? points(ownTeam.points ?? (ownTeam.matchedPlayers ? ownTeam.knownPoints : null)) : "MVP"}{ownTeam && !ownTeam.complete && ownTeam.matchedPlayers > 0 && <small> partial</small>}</strong></div><div><span>Last data update</span><strong className="season-summary-date">{season?.snapshot ? dateTime(season.snapshot.fetchedAt) : "Not fetched yet"}</strong></div></div>

      {season?.raceHistory && <SeasonRaceTimeline history={season.raceHistory} ownTeamId={ownTeamId}/>}

      <div className="season-main-grid">
        <section className="season-standings-panel" aria-labelledby="season-standings-title">
          <div className="season-section-heading"><div><span className="season-eyebrow">THE TABLE</span><h2 id="season-standings-title">Franchise standings</h2></div><span>{season?.teams.length ?? 0} teams</span></div>
          <div className="season-standings-legend" aria-hidden="true"><span>POS</span><span>FRANCHISE</span><span>COVERAGE</span><span>POINTS</span><span/></div>
          <ol className="season-standings" aria-label="Franchise season standings">{season?.teams.map(team => <li key={team.id}><button className={`season-standing${team.id === ownTeamId ? " is-own" : ""}${team.rank === 1 ? " is-first" : ""}`} onClick={() => setSelectedTeamId(team.id)} aria-label={`View ${team.name} season points`} style={{ "--season-team": team.color, "--season-score-width": `${Math.max(0, Math.min(100, Math.abs(team.knownPoints) / maxPoints * 100))}%` } as CSSProperties}><span className="season-rank">{team.rank === 1 ? <Crown size={23}/> : team.rank == null ? "—" : String(team.rank).padStart(2, "0")}</span><span className="season-standing-franchise"><TeamCrest team={team}/><span><strong>{team.name}{team.id === ownTeamId && <b>YOU</b>}</strong><small>{team.manager}</small><i aria-hidden="true"/></span></span><span className={`season-coverage${team.complete && team.totalPlayers > 0 ? " is-complete" : ""}`}>{team.matchedPlayers}<span> / {team.totalPlayers}</span><small>{team.totalPlayers === 0 ? "No signings" : team.complete ? "All matched" : "Matched"}</small></span><span className={`season-standing-points${team.knownPoints < 0 ? " is-negative" : ""}`}><strong>{points(team.points ?? (team.matchedPlayers ? team.knownPoints : null))}</strong><small>{team.matchedPlayers && !team.complete ? "Partial" : team.totalPlayers && !team.matchedPlayers ? "Pending" : "points"}</small></span><ChevronRight className="season-standing-arrow" size={19}/></button></li>)}</ol>
          <div className="season-table-footnote"><ShieldCheck size={16}/><span>Unmatched players stay pending. Negative MVP points count too.</span></div>
        </section>

        <aside className="season-source-panel" aria-labelledby="season-source-title">
          <div className="season-section-heading"><div><span className="season-eyebrow">THE SCORE FEED</span><h2 id="season-source-title">Season source</h2></div><Link2 size={22}/></div>
          {canManage ? <form onSubmit={event => { event.preventDefault(); void mutate("fetch"); }}>
            <label htmlFor={sourceId}>ESPNcricinfo MVP page</label>
            <input id={sourceId} type="url" inputMode="url" autoComplete="url" value={sourceUrl} onChange={event => setSourceDraft(event.target.value)} placeholder={DEFAULT_SOURCE} required maxLength={2000}/>
            <button type="submit" className="season-button season-button-primary" disabled={disabled || refreshOffline || !sourceUrl.trim()}>{busy === "fetch" ? <LoaderCircle className="season-spin" size={18}/> : <RefreshCw size={18}/>}{busy === "fetch" ? "Fetching fresh points…" : sourceDirty ? "Save link & fetch latest" : "Fetch latest data"}</button>
            {cloudMode ? <div className={`season-refresh-status${refreshOffline ? " is-offline" : ""}`} role="status"><span><i/>{refreshOffline ? "Cloud refresh unavailable" : "Cloud refresh ready"}</span>{refreshOffline && <p>Live refreshing is temporarily unavailable. Saved points, snapshots and table imports remain available.</p>}</div> : workerMode ? <div className={`season-refresh-status${refreshOffline ? " is-offline" : ""}`} role="status"><span><i/>{refreshOffline ? "Refresh service offline" : "Refresh service online"}</span>{refreshOffline && <p>The Pavilion fetch service needs to be running on the host computer. Saved points, snapshots and table imports remain available.</p>}</div> : null}
            {refreshOffline && sourceDirty && <button type="button" className="season-button season-button-secondary" disabled={disabled || !sourceUrl.trim()} onClick={() => void mutate("configure", { sourceUrl: sourceUrl.trim() })}>{busy === "configure" ? <LoaderCircle className="season-spin" size={17}/> : <Link2 size={17}/>}Save source link</button>}
            <p className="season-source-help">Choose a series MVP page. Fetch when you want to update points for everyone.</p>
            {season.reference && <div className="season-reference-option"><span><ShieldCheck size={17}/>{season.reference.playerCount} verified player entries</span><button type="button" className="season-button season-button-secondary" disabled={disabled || sourceDirty} onClick={() => void mutate("reference")}>{busy === "reference" ? <LoaderCircle className="season-spin" size={17}/> : <ArrowDownToLine size={17}/>}Load verified 2026 snapshot</button><p>Captured {dateTime(season.reference.fetchedAt)}. Saved snapshot, not a live refresh.</p>{sourceDirty && <p>{refreshOffline ? "Save the selected link first." : "Save and fetch the selected link first."}</p>}</div>}
          </form> : <p className="season-source-help">The room creator manages the source and fetches new points. Saved standings update for everyone.</p>}
          <div className="season-source-facts"><div><span>Saved source</span><a href={season?.snapshot?.sourceUrl ?? season?.sourceUrl ?? DEFAULT_SOURCE} target="_blank" rel="noreferrer">{season?.snapshot?.seriesName || "ESPNcricinfo MVP"}<ArrowUpRight size={16}/></a></div><div><span>Data received</span><strong>{season?.snapshot ? `${season.coverage.sourceRows} players` : "Awaiting first update"}</strong></div><div><span>Update method</span><strong>{season?.snapshot?.method === "reference" ? "Verified snapshot" : season?.snapshot?.method === "import" ? "Imported table" : season?.snapshot ? "Fetched from source" : "—"}</strong>{season?.snapshot?.method === "reference" && <p className="season-source-help">Captured {dateTime(season.snapshot.fetchedAt)}. This is saved source data, not a live refresh.</p>}</div>{(workerMode || cloudMode) && !canManage && <div><span>{cloudMode ? "Cloud refresh" : "Refresh service"}</span><strong className={refreshOffline ? "season-refresh-offline" : "season-refresh-online"}>{cloudMode ? refreshOffline ? "Unavailable" : "Ready" : refreshOffline ? "Offline" : "Online"}</strong></div>}{season?.lastFetchAttemptAt && <div><span>Last fetch attempt</span><strong>{dateTime(season.lastFetchAttemptAt)}</strong></div>}</div>
          {canManage && <details className="season-import-tools"><summary><FileSpreadsheet size={17}/>Import a points table<ChevronDown size={17}/></summary><p>If the website blocks automated fetching, paste its player points as CSV, TSV or JSON.</p><label htmlFor={importId}>Player points table</label><textarea id={importId} value={importText} onChange={event => setImportText(event.target.value)} maxLength={1000000} rows={6} spellCheck={false} placeholder={'name,points,matches,runs,wickets\nPlayer name,142.5,6,218,3'}/><button className="season-button season-button-secondary" disabled={disabled || !importText.trim()} onClick={() => void mutate("import", { text: importText })}>{busy === "import" ? <LoaderCircle className="season-spin" size={17}/> : <ArrowDownToLine size={17}/>}Save imported points</button></details>}
          {performers.length > 1 && <div className="season-chasers"><h3>Also making moves</h3>{performers.slice(1).map(({ player, team }) => <button key={player.id} onClick={() => setSelectedTeamId(team.id)}><span><PlayerImage player={player}/></span><span><strong>{player.name}</strong><small>{team.shortName} · {player.captain ? "Captain 2×" : player.viceCaptain ? "Vice captain 1.5×" : "MVP 1×"}</small></span><b>{points(player.points)}</b></button>)}</div>}
        </aside>
      </div>

      {season?.analytics && <SeasonAnalytics analytics={season.analytics} teams={season.teams} ownTeamId={ownTeamId} onTeamSelect={setSelectedTeamId}/>}

      {!!season?.unmatchedPlayers.length && <details className="season-match-tools"><summary><span><CircleAlert size={20}/><strong>{season.unmatchedPlayers.length} purchased {season.unmatchedPlayers.length === 1 ? "player needs" : "players need"} source data</strong><span>Review coverage</span></span><ChevronDown size={20}/></summary><div className="season-match-body"><p>These players have no confirmed match in the current source. Their points are pending—not zero.{canManage ? " Link a player only when you have verified their identity." : " The creator can match a source entry if its name differs."}</p><label className="season-search-label">Find a player<input type="search" value={mappingSearch} onChange={event => setMappingSearch(event.target.value)} placeholder="Search player or franchise"/></label><div className="season-unmatched-list">{unmapped.map(player => <div className="season-unmatched-row" key={player.id}><div><strong>{player.name}</strong><span>{player.teamName}</span></div>{canManage ? <><select aria-label={`Source match for ${player.name}`} value={mappingDrafts[player.id] ?? ""} onChange={event => setMappingDrafts(previous => ({ ...previous, [player.id]: event.target.value }))}><option value="">Choose a verified source player</option>{season.sourceRows.filter(row => !row.playerId || row.playerId === player.id).map(row => <option key={row.key} value={row.key}>{row.name} · {points(row.points)} MVP</option>)}</select><button className="season-button season-button-secondary" disabled={disabled || !mappingDrafts[player.id]} onClick={() => mapPlayer(player.id, mappingDrafts[player.id])}>Link player</button></> : <span className="season-pending-tag">Pending</span>}</div>)}</div>{!unmapped.length && <p>No players match this search.</p>}</div></details>}
      {canManage && season && Object.keys(season.mappings).length > 0 && <details className="season-match-tools"><summary><span><Link2 size={19}/><strong>Verified player links</strong><span>{Object.keys(season.mappings).length} saved</span></span><ChevronDown size={20}/></summary><div className="season-match-body">{Object.entries(season.mappings).map(([sourceKey, playerId]) => <div className="season-saved-link" key={sourceKey}><span><strong>{state.players.find(player => player.id === playerId)?.name ?? playerId}</strong><span><ArrowRight size={15}/>{season.sourceRows.find(row => row.key === sourceKey)?.name ?? "Previously linked source player"}</span></span><button className="season-text-button" disabled={disabled} onClick={() => void mutate("map", { mappings: Object.fromEntries(Object.entries(season.mappings).filter(([key]) => key !== sourceKey)) })}>Remove link</button></div>)}</div></details>}
    </>}

    <dialog ref={dialogRef} className="season-team-dialog" aria-labelledby="season-team-dialog-heading" onCancel={() => setSelectedTeamId(null)} onClose={() => setSelectedTeamId(null)} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) setSelectedTeamId(null); } }}>
      {selectedTeam && <SeasonTeamDetails team={selectedTeam} rateSummary={selectedRate} onClose={() => setSelectedTeamId(null)}/>}
    </dialog>
  </section>;
}

function SeasonTeamDetails({ team, rateSummary, onClose }: { team: SeasonTeam; rateSummary?: SeasonStatRow; onClose: () => void }) {
  return <div style={{ "--season-team": team.color } as CSSProperties}>
    <header className="season-dialog-heading"><TeamCrest team={team}/><div><span className="season-eyebrow">FRANCHISE POINTS</span><h2 id="season-team-dialog-heading">{team.name}</h2><p>{team.manager !== "No manager assigned" ? `Owned and Managed by: ${team.manager}` : "No manager has taken charge of this team"}</p></div><button className="season-icon-button" aria-label="Close franchise points" onClick={onClose}><X size={23}/></button></header>
    <div className="season-dialog-summary"><div><span>{team.complete ? "Season points" : "Known points"}</span><strong>{points(team.points ?? (team.matchedPlayers ? team.knownPoints : null))}</strong></div><div><span>Source coverage</span><strong>{team.matchedPlayers}<small> / {team.totalPlayers}</small></strong></div><div><span>Squad spending</span><strong>{formatMoney(team.spentLakhs)}</strong></div><div><span>Purse remaining</span><strong>{formatMoney(team.purseLakhs)}</strong></div></div>
    {team.players.length ? <><p className="season-dialog-note">Every purchased player contributes. Captain 2× · Vice captain 1.5× · Other signings 1×. Deviation = raw MVP − tournament average. Pts / match = each player’s weighted points ÷ matches.</p><p className="season-table-swipe"><ArrowLeftRight size={16}/>Swipe for MVP and match stats</p><div className="season-player-table-wrap" tabIndex={0} role="region" aria-label={`${team.name} player points, scroll horizontally for all statistics`}><table className="season-player-table season-player-table-analytics"><colgroup><col className="season-col-player"/><col className="season-col-points"/><col className="season-col-mvp"/><col className="season-col-multiplier"/><col className="season-col-deviation"/><col className="season-col-average"/><col className="season-col-stat"/><col className="season-col-stat"/><col className="season-col-stat"/></colgroup><thead><tr><th scope="col">Player</th><th scope="col">Team points</th><th scope="col">MVP points</th><th scope="col">Multiplier</th><th scope="col" title="Raw MVP minus tournament average">Deviation</th><th scope="col" title="Weighted team points divided by matches">Pts / match</th><th scope="col">Matches</th><th scope="col">Runs</th><th scope="col">Wickets</th></tr></thead><tbody>{team.players.map(player => <SeasonPlayerRow key={player.id} player={player}/>)}</tbody><tfoot><tr><th scope="row">{team.complete ? "Total points" : "Known total · incomplete coverage"}</th><td>{points(team.points ?? (team.matchedPlayers ? team.knownPoints : null))}</td><td colSpan={3}>{team.matchedPlayers} / {team.totalPlayers} scores matched</td><td className="season-player-average-total">{points(rateSummary?.value)}<small>{rateSummary?.coverage?.matched ?? 0} / {rateSummary?.coverage?.total ?? team.totalPlayers} rates known</small></td><td colSpan={3}/></tr></tfoot></table></div><p className="season-dialog-note"><ShieldCheck size={16}/>A dash means the source has no confirmed value. It does not mean zero.</p></> : <div className="season-dialog-empty"><Users size={42} strokeWidth={1}/><h3>{team.manager !== "No manager assigned" ? "No signings yet" : "No manager assigned"}</h3><p>{team.manager !== "No manager assigned" ? "Purchased players and their season points will appear here." : "This franchise is waiting for a manager to take charge."}</p></div>}
  </div>;
}

function SeasonPlayerRow({ player }: { player: SeasonPlayer }) {
  return <tr><th scope="row"><span className="season-player-identity"><span className="season-player-thumb"><PlayerImage player={player}/></span><span><strong>{player.name}{player.captain ? <b>C</b> : player.viceCaptain ? <b>VC</b> : null}</strong><small>{player.role} · {player.selection}{player.position != null ? ` ${player.position}` : ""}</small>{player.sourceName && player.sourceName !== player.name && <small>Source: {player.sourceName}</small>}</span></span></th><td className={`season-weighted-points${(player.points ?? 0) < 0 ? " is-negative" : ""}`}>{points(player.points)}{player.points === null && <small>Pending</small>}</td><td>{points(player.rawPoints)}</td><td><span className={`season-multiplier${player.multiplier > 1 ? " is-captain" : ""}`}>{player.multiplier}×</span></td><td className={`season-player-deviation${(player.deviation ?? 0) > 0 ? " is-positive" : (player.deviation ?? 0) < 0 ? " is-negative" : ""}`} title={player.deviation == null ? "No confirmed value" : String(player.deviation)}>{player.deviation != null && player.deviation > 0 ? "+" : ""}{points(player.deviation)}</td><td className="season-player-average" title={player.pointsPerMatch == null ? "No confirmed match count" : String(player.pointsPerMatch)}>{points(player.pointsPerMatch)}</td><td>{points(player.matches)}</td><td>{points(player.runs)}</td><td>{points(player.wickets)}</td></tr>;
}
