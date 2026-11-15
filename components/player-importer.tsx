"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, Check, ChevronLeft, ExternalLink, Globe2, LoaderCircle, LockKeyhole, RefreshCw, Search, ShieldCheck, Sparkles, UserRound, X } from "lucide-react";
import { PLAYER_ROLES } from "@/lib/auction-display";
import type { AuctionAction, Player, PlayerInput, RoomState } from "@/lib/auction";
import { AuctionRequestError, requestAuction } from "@/lib/auction-client";
import type { LookupCandidate, LookupPlayer, PlayerLookupResult } from "@/lib/player-lookup-types";
import { CATALOG_PORTRAITS } from "@/lib/catalog-portraits";
import { PLAYER_IMAGES } from "@/lib/visual-assets";
import "./player-importer.css";

type Props = {
  state: RoomState;
  isHost: boolean;
  existingPlayer?: Player;
  initialQuery?: string;
  onAction: (action: AuctionAction) => Promise<void>;
  onClose: () => void;
  onManual: (player?: Player) => void;
};

const canonical = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
const knownCountry = (value?: string | null) => Boolean(value?.trim() && !["unverified", "unknown"].includes(value.trim().toLowerCase()));
function profileIdentity(value?: string | null) {
  if (!value) return "";
  try { const url = new URL(value); return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`.toLowerCase(); }
  catch { return ""; }
}
function matchesProfile(player: Player, profile: LookupPlayer) {
  if (profileIdentity(player.profileUrl) && profileIdentity(player.profileUrl) === profileIdentity(profile.profileUrl)) return true;
  return canonical(player.name) === canonical(profile.name) && (!knownCountry(player.country) || !knownCountry(profile.country) || canonical(player.country) === canonical(profile.country ?? ""));
}
function cannotUpdate(state: RoomState, player?: Player) {
  return Boolean(player && (player.status === "sold" || (state.currentPlayerId === player.id && (state.phase !== "waiting" || state.leadingTeamId !== null))));
}
function displayDate(value?: string | null) {
  if (!value) return "Not supplied";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}
function sourceLabel(url: string) {
  try { const host = new URL(url).hostname; return host.includes("cricbuzz") ? "Cricbuzz" : host.includes("espncricinfo") ? "ESPNcricinfo" : host.replace(/^www\./, ""); }
  catch { return "Profile source"; }
}
function storedProfile(player: Player): LookupPlayer {
  return {
    id: player.id, name: player.name, country: knownCountry(player.country) ? player.country : null,
    dateOfBirth: player.birthDate ?? null, image: CATALOG_PORTRAITS[player.id] || player.image || null,
    profileUrl: player.profileUrl ?? "", provider: "Local catalog", role: player.role === "Marquee" ? null : player.role,
    battingStyle: player.battingStyle ?? null, bowlingStyle: player.bowlingStyle ?? null,
    stats: player.stats, statsFormat: player.statsFormat === "Unknown" ? null : player.statsFormat ?? null,
    statsScope: "career", fetchedAt: player.dataUpdatedAt ?? "", sourceUrls: player.dataSources?.map(source => source.url) ?? [],
    missingFields: [], warnings: [], basePriceSuggested: player.basePrice,
  };
}

function ProfileImage({ src }: { src?: string | null; name: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return <span className="import-photo" aria-hidden="true">{src && failedSource !== src ? <img src={src} alt="" width={112} height={128} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSource(src)} /> : <UserRound size={35} />}</span>;
}

export function PlayerImporter({ state, isHost, existingPlayer, initialQuery = "", onAction, onClose, onManual }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const titleId = useId();
  const helpId = useId();
  const [query, setQuery] = useState(initialQuery || existingPlayer?.profileUrl || existingPlayer?.name || "");
  const [result, setResult] = useState<PlayerLookupResult | null>(null);
  const [profile, setProfile] = useState<LookupPlayer | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [targetId, setTargetId] = useState(existingPlayer?.id ?? "");
  const [country, setCountry] = useState("");
  const [role, setRole] = useState<Player["role"] | "">("");
  const [price, setPrice] = useState("");
  const [overseas, setOverseas] = useState(false);
  const [overseasExplicit, setOverseasExplicit] = useState(false);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const target = state.players.find(player => player.id === targetId);
  const blocked = !isHost || cannotUpdate(state, target);
  const duplicateMatches = profile ? state.players.filter(player => matchesProfile(player, profile)) : [];
  const review = profile ?? (existingPlayer ? storedProfile(existingPlayer) : null);
  const storedSourced = Boolean(existingPlayer?.profileUrl && existingPlayer.dataSources?.length && existingPlayer.eligibilityVerified !== false);
  const identityMismatch = Boolean(profile && existingPlayer && !matchesProfile(existingPlayer, profile));
  const conflictingIdentity = Boolean(existingPlayer && duplicateMatches.length && !duplicateMatches.some(player => player.id === existingPlayer.id));

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { sequence.current += 1; controller.current?.abort(); element?.close(); };
  }, []);

  function cancelLookup() {
    sequence.current += 1;
    controller.current?.abort();
    setLoading(false);
    setNotice("Lookup canceled. Your player pool is unchanged.");
  }
  function close() {
    if (saving) return;
    controller.current?.abort();
    onClose();
  }
  function prepareReview(found: LookupPlayer, selected?: Player) {
    setTargetId(selected?.id ?? "");
    setCountry(found.country || (knownCountry(selected?.country) ? selected!.country : ""));
    setRole(selected?.role ?? found.role ?? "");
    setPrice(String((selected?.basePrice ?? found.basePriceSuggested) / 100));
    setOverseas(selected?.eligibilityVerified !== false && selected ? selected.isOverseas : Boolean(found.country && canonical(found.country) !== "india"));
    setOverseasExplicit(Boolean(selected && selected.eligibilityVerified !== false));
    setIdentityConfirmed(false);
  }
  async function lookup(value = query) {
    const search = value.trim();
    if (search.length < 2) { setError("Enter a player name or a complete profile link."); return; }
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const requestId = ++sequence.current;
    setLoading(true); setError(""); setNotice(""); setResult(null); setProfile(null); setQuery(search);
    try {
      const response = await requestAuction<PlayerLookupResult>("/api/players/lookup", { query: search }, undefined, { timeoutMs: 35_000, signal: active.signal });
      if (requestId !== sequence.current || active.signal.aborted) return;
      setResult(response);
      if (response.status === "found" && response.player) {
        const matches = state.players.filter(player => matchesProfile(player, response.player!));
        const selected = existingPlayer ?? (matches.length === 1 ? matches[0] : undefined);
        setProfile(response.player);
        prepareReview(response.player, selected);
      }
    } catch (cause) {
      if (requestId !== sequence.current || active.signal.aborted || (cause instanceof AuctionRequestError && cause.code === "REQUEST_ABORTED")) return;
      setError(cause instanceof AuctionRequestError && cause.code === "REQUEST_TIMEOUT" ? "Player sources took too long to respond. Try a direct profile link, retry the search, or enter details manually." : cause instanceof AuctionRequestError && cause.code === "NETWORK_ERROR" ? "Player search could not connect. Check your connection and try again, or enter details manually." : cause instanceof Error ? cause.message : "Player lookup could not be completed. Try again or enter the player manually.");
    } finally { if (requestId === sequence.current) setLoading(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!profile || blocked) return;
    if (conflictingIdentity) { setError("This profile matches another entry in your pool. Open that player's details to update it."); return; }
    if (identityMismatch && !identityConfirmed) { setError("Confirm that the returned profile belongs to this player before updating."); return; }
    const amount = Math.round(Number(price) * 100);
    if (!knownCountry(country) || !role || !Number.isFinite(amount) || amount < 1 || amount > 10000) { setError("Confirm the country, category, and a base price from ₹1 lakh to ₹100 crore."); return; }
    if (!target && duplicateMatches.length) { setError("This player is already in your pool. Choose the existing entry below to update it."); return; }
    const complete = Object.values(profile.stats).every(value => value !== null) && Boolean(profile.statsFormat) && Boolean(profile.country);
    const values: PlayerInput = {
      ...(target ?? {}), name: target?.name ?? profile.name, country: country.trim(), role,
      basePrice: amount, isOverseas: overseas, eligibilityVerified: true,
      stats: profile.stats, statsFormat: profile.statsFormat ?? "Unknown",
      dataStatus: complete && canonical(country) === canonical(profile.country ?? "") ? "verified" : "partial",
      image: profile.image || target?.image, profileUrl: profile.profileUrl || target?.profileUrl,
      dataSources: [...new Set(profile.sourceUrls)].slice(0, 5).map(url => ({ label: sourceLabel(url), url })),
      dataUpdatedAt: profile.fetchedAt, playingRole: profile.role || target?.playingRole,
      battingStyle: profile.battingStyle || target?.battingStyle, bowlingStyle: profile.bowlingStyle || target?.bowlingStyle,
      birthDate: profile.dateOfBirth || target?.birthDate,
    };
    setSaving(true);
    try {
      await onAction(target ? { type: "update_player", player: { ...target, ...values, id: target.id } } : { type: "add_player", player: values });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The player could not be saved. Please try again."); }
    finally { setSaving(false); }
  }
  const warnings = [...new Set([...(result?.warnings ?? []), ...(profile?.warnings ?? [])])];
  return <dialog ref={dialog} className="manage-dialog player-importer" aria-labelledby={titleId} aria-describedby={helpId} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="manage-dialog-head import-heading"><div><span className="import-eyebrow"><Sparkles size={14} />PLAYER INTELLIGENCE</span><h2 id={titleId}>{existingPlayer ? "Player details" : "Find your next signing"}</h2><p id={helpId}>Search a name or paste a Cricbuzz or ESPNcricinfo link. Saved players join the common catalog for every room.</p></div><button type="button" className="manage-icon-button" aria-label="Close player lookup" disabled={saving} onClick={close}><X size={20} /></button></div>
    <div className="import-body">
      <form className="import-search-form" onSubmit={event => { event.preventDefault(); void lookup(); }}>
        <label className="manage-field" htmlFor={`${titleId}-query`}>Player name or profile URL</label>
        <div className="import-search-row"><div className="import-search-input"><Search size={19} /><input id={`${titleId}-query`} autoFocus={!existingPlayer} type="text" required minLength={2} maxLength={1000} value={query} disabled={saving || loading} placeholder="e.g. Virat Kohli or a player profile link" onChange={event => setQuery(event.target.value)} /></div><button type="submit" className="manage-button manage-primary" disabled={loading || saving}>{loading ? <LoaderCircle className="import-spin" size={17} /> : <Search size={17} />}{loading ? "Searching…" : existingPlayer ? "Fetch latest" : "Find player"}</button></div>
      </form>
      {!review && !result && !loading && <div className="import-example-row"><span>Try a name</span>{["Virat Kohli", "Rashid Khan", "Rachin Ravindra"].map(name => <button type="button" key={name} onClick={() => void lookup(name)}>{name}<ArrowRight size={13} /></button>)}</div>}
      {loading && <div className="import-progress" role="status"><LoaderCircle className="import-spin" size={22} /><div><strong>Checking player sources</strong><span>Matching the identity and reading available career statistics.</span></div><button type="button" onClick={cancelLookup}>Cancel</button></div>}
      {notice && <p className="import-notice" role="status">{notice}</p>}
      {error && <p className="manage-error" role="alert">{error}</p>}
      {warnings.length > 0 && <div className="import-warning"><ShieldCheck size={18} /><div>{warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div></div>}
      {result?.status === "candidates" && <section className="import-candidates" aria-label="Matching player profiles"><div className="import-section-label"><h3>Choose the right player</h3><span>{result.candidates.length} possible matches</span></div><p>Compare the country and date of birth, then open a profile to review its statistics.</p><div>{result.candidates.map((candidate: LookupCandidate) => <button type="button" className="import-candidate" key={`${candidate.provider}-${candidate.id}`} disabled={loading} onClick={() => void lookup(candidate.profileUrl)}><ProfileImage src={candidate.image} name={candidate.name} /><span><strong>{candidate.name}</strong><span><Globe2 size={13} />{candidate.country || "Country not supplied"}</span><small>{candidate.dateOfBirth ? `Born ${displayDate(candidate.dateOfBirth)}` : "Date of birth not supplied"} · {candidate.provider}</small></span><ArrowRight size={18} /></button>)}</div></section>}
      {result?.status === "not_found" && <div className="import-empty"><Search size={30} /><h3>No verified match yet</h3><p>Try the full name or a direct player profile link. You can also add the player manually and leave unavailable statistics blank.</p></div>}
      {!review && !result && !loading && <div className="import-intro"><div className="import-intro-icon"><BookOpen size={28} /></div><h3>Real profiles. Informed bids.</h3><p>Find player photos, playing styles, and career numbers from their source. Your auction category and opening price stay in your hands.</p><div><span><Check size={15} />Identity review</span><span><Check size={15} />Source links</span><span><Check size={15} />No invented stats</span></div></div>}
      {review && !loading && <section className="import-profile" aria-label={`${review.name} profile review`}>
        <div className="import-section-label"><h3>{profile ? "Review this profile" : "Saved player profile"}</h3><span className={`import-data-tag ${profile || storedSourced ? "import-data-good" : ""}`}><ShieldCheck size={13} />{profile ? "Source fetched" : existingPlayer?.dataStatus === "manual" ? "Manual details" : storedSourced ? "Sourced profile" : "Needs review"}</span></div>
        <div className="import-profile-hero"><ProfileImage src={(!identityMismatch && (PLAYER_IMAGES[target?.id ?? existingPlayer?.id ?? ""] || CATALOG_PORTRAITS[target?.id ?? existingPlayer?.id ?? ""])) || review.image} name={review.name} /><div><span className="import-provider">{profile ? review.provider : "YOUR PLAYER POOL"}</span><h3>{review.name}</h3><p><Globe2 size={14} />{review.country || "Country not supplied"}<span>·</span>{review.role || existingPlayer?.playingRole || "Playing role not supplied"}</p><p className="import-birthday">{review.dateOfBirth ? `Born ${displayDate(review.dateOfBirth)}` : "Date of birth not supplied"}</p></div></div>
        <div className="import-stats-header"><strong>{review.statsFormat || "Format not supplied"} career statistics</strong><span>{review.fetchedAt ? `Fetched ${displayDate(review.fetchedAt)}` : "Source date not supplied"}</span></div>
        <div className="import-stats">{([['matches', 'Matches'], ['runs', 'Runs'], ['wickets', 'Wickets'], ['strikeRate', 'Strike rate']] as const).map(([key, label]) => <div key={key}><span>{label}</span><strong>{review.stats[key] === null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(review.stats[key]!)}</strong>{review.stats[key] === null && <small>Not available</small>}</div>)}</div>
        <dl className="import-playing-styles"><div><dt>Batting style</dt><dd>{review.battingStyle || "Not supplied"}</dd></div><div><dt>Bowling style</dt><dd>{review.bowlingStyle || "Not supplied"}</dd></div></dl>
        {Object.values(review.stats).some(value => value === null) && <p className="import-fact-note">A dash means the source did not supply that statistic. It is not recorded as zero.</p>}
        {!profile && storedSourced && Object.values(review.stats).every(value => value === null) && <p className="import-fact-note">The player’s identity and profile source are confirmed. Career figures were not available from the saved source.</p>}
        {!profile && existingPlayer?.dataStatus === "manual" && <p className="import-fact-note">This entry contains manual details. Source links are provided for reference; the saved numbers may differ from their source.</p>}
        {profile && profile.missingFields.length > 0 && <p className="import-fact-note">Source gaps: {profile.missingFields.map(field => field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/stats\./g, "")).join(", ")}.</p>}
        <div className="import-sources"><span><ExternalLink size={14} />Sources</span>{[...new Set([...review.sourceUrls, ...(review.profileUrl ? [review.profileUrl] : [])])].map((url, index) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{sourceLabel(url)}{index ? ` · ${index + 1}` : ""}<ArrowRight size={12} /></a>)}{!review.sourceUrls.length && !review.profileUrl && <span>No external source attached</span>}</div>
        {review.fetchedAt && <p className="import-fact-note">The date shows when these details were fetched. Provider statistics may update on a different schedule.</p>}
      </section>}
      {profile && !loading && <form className="import-review-form" onSubmit={save}>
        {duplicateMatches.length > 1 && !existingPlayer && <label className="manage-field import-duplicate-selector">Matching entries already exist in your pool<select required value={targetId} onChange={event => { const selected = state.players.find(player => player.id === event.target.value); prepareReview(profile, selected); }}><option value="">Choose an existing entry to update</option>{duplicateMatches.map(player => <option key={player.id} value={player.id}>{player.name} · {player.country}</option>)}</select></label>}
        {target && <div className="import-existing"><Check size={18} /><div><strong>{target.name} is already in this pool</strong><span>Review an update to this entry. Its auction category and base price are preserved unless you change them below.</span></div></div>}
        {conflictingIdentity && <div className="import-warning"><ShieldCheck size={18} /><p>This profile already matches {duplicateMatches.map(player => player.name).join(", ")} in your pool. Open that existing entry to update its details.</p></div>}
        {identityMismatch && <label className="manage-check import-identity-check"><input type="checkbox" checked={identityConfirmed} disabled={blocked} onChange={event => setIdentityConfirmed(event.target.checked)} /><span>I confirm this is the same player as {existingPlayer?.name}.<small>The source name differs. Confirm the identity before replacing saved details.</small></span></label>}
        <fieldset disabled={blocked || saving}>
          <div className="import-section-label"><h3>Auction details</h3><span>You make the final call</span></div>
          <div className="manage-form-grid"><label className="manage-field">{review?.country ? "Country" : "Confirm country"}<input required maxLength={50} value={country} placeholder="Enter the confirmed country" onChange={event => { setCountry(event.target.value); if (!overseasExplicit) setOverseas(Boolean(event.target.value.trim()) && canonical(event.target.value) !== "india"); }} /></label><label className="manage-field">Auction category<select required value={role} onChange={event => setRole(event.target.value as Player["role"])}><option value="">Choose a category</option>{PLAYER_ROLES.map(value => <option key={value}>{value}</option>)}</select></label><label className="manage-field">Base price (₹ crore)<input type="number" min="0.01" max="100" step="0.01" required value={price} onChange={event => setPrice(event.target.value)} /><span className="manage-field-note">Your opening bid, not a market valuation.</span></label><label className="manage-check import-overseas"><input type="checkbox" checked={overseas} onChange={event => { setOverseas(event.target.checked); setOverseasExplicit(true); }} /><span>Overseas player<small>Counts towards the overseas limit.</small></span></label></div>
        </fieldset>
        {blocked && <div className="import-warning"><LockKeyhole size={18} /><p>{!isHost ? "Only the auctioneer can add or update player details." : "This player is sold or has an active auction. Details remain viewable, but updates are locked."}</p></div>}
        <div className="import-actions"><button type="button" className="manage-button" disabled={saving} onClick={() => { setProfile(null); setResult(null); setError(""); }}><ChevronLeft size={16} />Back</button>{isHost && <button type="submit" className="manage-button manage-primary" disabled={blocked || saving || conflictingIdentity || (identityMismatch && !identityConfirmed) || (!target && duplicateMatches.length > 0)}>{saving ? <LoaderCircle size={16} className="import-spin" /> : target ? <RefreshCw size={16} /> : <Check size={16} />}{saving ? "Saving…" : target ? "Update existing player" : "Add to common pool"}</button>}</div>
      </form>}
      <div className="import-footer"><span>Prefer to curate the details yourself?</span>{isHost && <button type="button" disabled={saving || cannotUpdate(state, existingPlayer)} onClick={() => { controller.current?.abort(); onManual(existingPlayer); }}>{existingPlayer ? "Edit manually" : "Enter player manually"}<ArrowRight size={14} /></button>}{!isHost && <span>Ask your auctioneer to update this profile.</span>}</div>
    </div>
  </dialog>;
}
