"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Download, ImagePlus, LoaderCircle, Share2, Sparkles } from "lucide-react";
import type { RoomState, Team } from "@/lib/auction";
import { TeamCrest } from "./ipl-visuals";
import "./franchise-posters.css";

type Props = { state: RoomState; token: string; connected: boolean; preferredTeamId?: string };

export function FranchisePosters({ state, token, connected, preferredTeamId }: Props) {
  const [selectedId, setSelectedId] = useState(preferredTeamId ?? "");
  const selectId = useId();
  const teams = state.teams.filter(team => team.squad.length > 0);
  const team = teams.find(team => team.id === selectedId) ?? teams.find(team => team.id === preferredTeamId) ?? teams[0];
  if (state.endedAt === undefined || !team) return null;
  // A corrected sale or newly saved XI invalidates the preview, but polling/chat does not.
  const signature = JSON.stringify([state.code, state.endedAt, state.name, state.resultsRevision, team.id, team.name, team.color, team.squad, team.lineup, state.completedManagers?.[team.id], team.squad.map(purchase => { const player = state.players.find(player => player.id === purchase.playerId); return [player?.name, player?.playingRole, player?.role]; })]);
  return <section className="franchise-posters" aria-label="Franchise squad posters" style={{ "--poster-accent": team.color } as CSSProperties}>
    <div className="franchise-poster-intro"><span className="result-overline"><Sparkles size={16}/>FRANCHISE EDITION</span><h2>Your squad. Ready to share.</h2><p>Every signing, your franchise colours, and your saved captain and vice captain.</p>
      <label htmlFor={selectId}>Choose a franchise</label><select id={selectId} value={team.id} onChange={event => setSelectedId(event.target.value)}>{teams.map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select>
      <span className="franchise-poster-format">High-resolution PNG · 1440 × 1800</span>
    </div>
    <PosterStudio key={`${token}:${signature}`} state={state} team={team} token={token} connected={connected}/>
  </section>;
}

function PosterStudio({ state, team, token, connected }: { state: RoomState; team: Team; token: string; connected: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort("navigation"); }, [token]);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    // Object URLs are external resources: recreate them when Activity restores this page's effects.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const preview = file && previewUrl ? { file, url: previewUrl } : null;

  async function generate() {
    if (controller.current || !connected) return;
    const pending = new AbortController(); controller.current = pending; setBusy(true); setError("");
    const timer = setTimeout(() => pending.abort(), 60000);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(state.code)}/poster?team=${encodeURIComponent(team.id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: pending.signal });
      if (!response.ok) throw new Error(response.status === 401 ? "Reconnect to your room before creating a poster." : response.status === 409 ? "Posters need a completed auction and a squad with signings." : "The poster could not be prepared. Please try again.");
      if (!response.headers.get("content-type")?.includes("image/png")) throw new Error("The server returned an incomplete poster. Please try again.");
      const blob = await response.blob();
      if (controller.current !== pending) return;
      if (!blob.size || blob.size > 20_000_000) throw new Error("The poster download is incomplete. Please try again.");
      const filename = `Pavilion-${state.code.replace(/[^a-z0-9-]/gi, "")}-${team.shortName.replace(/[^a-z0-9-]/gi, "")}-squad.png`;
      setFile(new File([blob], filename, { type: "image/png" }));
    } catch (cause) {
      if (controller.current === pending && pending.signal.reason !== "navigation") setError(pending.signal.aborted ? "The poster took too long to prepare. Please try again." : cause instanceof Error ? cause.message : "Could not create the poster.");
    } finally { clearTimeout(timer); if (controller.current === pending) { controller.current = null; setBusy(false); } }
  }

  async function share() {
    if (!preview || sharing) return;
    setSharing(true); setError("");
    try { await navigator.share({ files: [preview.file], title: `${team.name} — ${state.name}` }); }
    catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError("Sharing is unavailable here. Download the PNG to share it instead."); }
    finally { setSharing(false); }
  }

  const shareAvailable = preview && typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [preview.file] });
  return <div className="franchise-poster-studio">
    <div className={`franchise-poster-preview${preview ? " is-generated" : ""}`} aria-busy={busy}>
      {preview ? /* eslint-disable-next-line @next/next/no-img-element */
        <a href={preview.url} target="_blank" rel="noreferrer" aria-label={`Open ${team.name} squad poster at full size`}><img src={preview.url} width={1440} height={1800} alt={`${team.name} squad poster with every signing, captain and vice captain`}/></a>
        : <div className="franchise-poster-placeholder" aria-hidden="true"><span>PAVILION / FRANCHISE EDITION</span><TeamCrest team={team}/><strong>THE<br/>SQUAD</strong><b>{team.name}</b><span>{team.squad.length} {team.squad.length === 1 ? "SIGNING" : "SIGNINGS"} · ONE FRANCHISE</span></div>}
      {busy && <div className="franchise-poster-loading"><LoaderCircle size={28}/><span>Creating your poster…</span></div>}
    </div>
    <div className="franchise-poster-actions">
      {preview ? <><a className="button primary" href={preview.url} download={preview.file.name}><Download size={18}/>Download PNG</a>{shareAvailable && <button className="button secondary" disabled={sharing} onClick={() => void share()}><Share2 size={18}/>{sharing ? "Sharing…" : "Share poster"}</button>}<span>Includes the latest saved squad and XI.</span></>
        : <button className="button primary" disabled={busy || !connected} onClick={() => void generate()}><ImagePlus size={18}/>{busy ? "Preparing poster…" : "Generate squad poster"}</button>}
    </div>
    {error && <p className="franchise-poster-error" role="alert">{error}</p>}
  </div>;
}
