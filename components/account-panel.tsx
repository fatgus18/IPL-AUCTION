"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, ChevronRight, Download, Eye, EyeOff, Gavel, KeyRound, LoaderCircle, LogOut, Pause, RefreshCw, ShieldCheck, Trophy, UserRound, Users } from "lucide-react";
import { AccountRequestError, requestAccount, type AccountRoomResume, type AccountRoomSummary, type AccountUser } from "@/lib/account-client";
import { parseRoomSession, type RoomSession } from "@/lib/practice-session";
import { TeamCrest } from "./ipl-visuals";
import "./account-panel.css";

type AccountPanelProps = {
  user: AccountUser | null;
  currentSession?: RoomSession | null;
  refreshKey?: number;
  onAuthenticated: (user: AccountUser) => void | Promise<void>;
  onSignedOut: (rooms: AccountRoomSummary[]) => void | Promise<void>;
  onResume: (room: AccountRoomResume) => void | Promise<void>;
  onLinked?: () => void | Promise<void>;
};

export function AccountPanel(props: AccountPanelProps) {
  return props.user
    ? <SavedAuctions key={props.user.id} {...props} user={props.user} />
    : <AccountAccess onAuthenticated={props.onAuthenticated} />;
}

function AccountAccess({ onAuthenticated }: Pick<AccountPanelProps, "onAuthenticated">) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const usernameId = useId();
  const passwordId = useId();
  const titleId = useId();
  const hintId = useId();
  const errorId = useId();

  useEffect(() => () => request.current?.abort(), []);

  function changeMode(next: typeof mode) {
    setMode(next);
    setPassword("");
    setVisible(false);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await requestAccount<{ user: AccountUser }>(`/api/account/${mode}`, {
        method: "POST", body: JSON.stringify({ username: username.trim(), password }),
      }, controller.signal);
      if (!result.user?.id || !result.user.username) throw new Error("Your account could not be loaded. Please try signing in again.");
      setPassword("");
      await onAuthenticated(result.user);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to sign in. Please try again.");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <section className="account-panel" aria-labelledby={titleId}>
    <header className="account-heading">
      <span className="account-emblem" aria-hidden="true"><KeyRound size={25} strokeWidth={1.5} /></span>
      <h2 id={titleId}>{mode === "login" ? "Welcome back." : "Make it your auction."}</h2>
      <p>Keep your rooms and return to your team on any device.</p>
    </header>
    <div className="account-access-modes" aria-label="Account access">
      <button type="button" className={mode === "login" ? "is-active" : ""} aria-pressed={mode === "login"} disabled={busy} onClick={() => changeMode("login")}>Sign in</button>
      <button type="button" className={mode === "register" ? "is-active" : ""} aria-pressed={mode === "register"} disabled={busy} onClick={() => changeMode("register")}>Create account</button>
    </div>
    <form className="account-form" onSubmit={submit}>
      <div className="account-field">
        <label htmlFor={usernameId}>Username</label>
        <input id={usernameId} name="username" value={username} onChange={event => setUsername(event.target.value)} required minLength={3} maxLength={30} pattern="[A-Za-z0-9_]{3,30}" autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy} aria-describedby={mode === "register" ? hintId : undefined} placeholder="Your username" />
      </div>
      <div className="account-field">
        <label htmlFor={passwordId}>Password</label>
        <div className="account-password-field">
          <input id={passwordId} name="password" type={visible ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} required minLength={12} maxLength={128} autoComplete={mode === "register" ? "new-password" : "current-password"} disabled={busy} aria-describedby={mode === "register" ? hintId : undefined} />
          <button type="button" className="account-password-toggle" onClick={() => setVisible(value => !value)} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} disabled={busy}>{visible ? <EyeOff size={19} /> : <Eye size={19} />}</button>
        </div>
      </div>
      {mode === "register" && <p className="account-form-hint" id={hintId}>Username: 3–30 letters, numbers or underscores. Password: 12–128 characters.</p>}
      {error && <p className="account-feedback is-error" id={errorId} role="alert">{error}</p>}
      <button type="submit" className="account-primary" disabled={busy} aria-describedby={error ? errorId : undefined}>
        {busy ? <LoaderCircle className="account-spinner" size={18} aria-hidden="true" /> : null}
        {busy ? (mode === "login" ? "Signing in…" : "Creating account…") : (mode === "login" ? "Sign in" : "Create account")}
        {!busy && <ArrowRight size={18} aria-hidden="true" />}
      </button>
    </form>
    <p className="account-security-note"><ShieldCheck size={17} aria-hidden="true" />Your squads, bids and saved lineups stay with your room.</p>
  </section>;
}

function SavedAuctions({ user, currentSession, refreshKey = 0, onResume, onSignedOut, onLinked }: AccountPanelProps & { user: AccountUser }) {
  const [rooms, setRooms] = useState<AccountRoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [operation, setOperation] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const actionRequest = useRef<AbortController | null>(null);
  const titleId = useId();

  useEffect(() => () => actionRequest.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    requestAccount<{ rooms: AccountRoomSummary[] }>("/api/account/rooms", {}, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result.rooms)) throw new Error("Your saved rooms could not be read. Try refreshing the list.");
        setRooms(result.rooms);
        setLoadError("");
      })
      .catch(failure => {
        if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : "Unable to load your auctions.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user.id, refreshKey, revision]);

  async function perform(key: string, action: (signal: AbortSignal) => Promise<void>) {
    if (actionRequest.current) return;
    const controller = new AbortController();
    actionRequest.current = controller;
    setOperation(key);
    setError("");
    setFeedback("");
    try { await action(controller.signal); } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "This action could not be completed. Please try again.");
    } finally {
      actionRequest.current = null;
      if (!controller.signal.aborted) setOperation(null);
    }
  }

  function refresh() {
    setLoading(true);
    setLoadError("");
    setRevision(value => value + 1);
  }

  function resume(room: AccountRoomSummary) {
    void perform(room.code, async signal => {
      const result = await requestAccount<AccountRoomResume>(`/api/account/rooms/${encodeURIComponent(room.code)}/resume`, { method: "POST", body: "{}" }, signal);
      if (!result.state?.code || !result.token || !result.memberId) throw new Error("The room could not be reopened. Refresh your list and try again.");
      await onResume(result);
    });
  }

  function signOut() {
    void perform("logout", async signal => {
      // Refresh before revoking the cookie so the parent only clears access
      // that this account can recover. Unlinked guest rooms must be preserved.
      const saved = await requestAccount<{ rooms: AccountRoomSummary[] }>("/api/account/rooms", {}, signal);
      if (!Array.isArray(saved.rooms)) throw new Error("Your saved rooms could not be checked. Please retry signing out.");
      await requestAccount("/api/account/logout", { method: "POST", body: "{}" }, signal);
      await onSignedOut(saved.rooms);
    });
  }

  function linkCurrentRoom() {
    if (!currentSession) return;
    void perform("link", async signal => {
      await requestAccount("/api/account/rooms", { method: "POST", body: JSON.stringify(currentSession) }, signal);
      setFeedback("This room is saved to your account.");
      await onLinked?.();
      refresh();
    });
  }

  function importBrowserRooms() {
    void perform("import", async signal => {
      const saved = new Map<string, RoomSession>();
      try {
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (!key?.startsWith("pavilion-session-")) continue;
          const session = parseRoomSession(localStorage.getItem(key));
          if (session) saved.set(session.code, session);
        }
      } catch { throw new Error("Browser storage is unavailable. Allow site storage, then try saving your rooms again."); }
      if (currentSession) saved.set(currentSession.code, currentSession);
      const pending = [...saved.values()].filter(session => !rooms.some(room => room.code === session.code && room.memberId === session.memberId));
      if (!pending.length) {
        setFeedback(saved.size ? "Your rooms from this browser are already saved." : "No saved rooms were found in this browser.");
        return;
      }
      let linked = 0;
      let unavailable = 0;
      for (const session of pending) {
        if (signal.aborted) return;
        try {
          await requestAccount("/api/account/rooms", { method: "POST", body: JSON.stringify(session) }, signal);
          linked += 1;
        } catch (failure) {
          if (signal.aborted) return;
          if (failure instanceof AccountRequestError && failure.status === 401) throw failure;
          unavailable += 1;
        }
      }
      setFeedback(`${linked} ${linked === 1 ? "room" : "rooms"} saved.${unavailable ? ` ${unavailable} ${unavailable === 1 ? "room could" : "rooms could"} not be saved; it may have been deleted or belong to another account.` : ""}`);
      await onLinked?.();
      refresh();
    });
  }

  const busy = operation !== null;
  const currentNeedsLink = currentSession && !loading && !loadError && !rooms.some(room => room.code === currentSession.code && room.memberId === currentSession.memberId);
  return <section className="account-panel account-saved" aria-labelledby={titleId}>
    <header className="account-heading">
      <span className="account-emblem" aria-hidden="true"><UserRound size={25} strokeWidth={1.5} /></span>
      <h2 id={titleId}>My auctions.</h2>
      <p className="account-identity">Signed in as <strong>@{user.username}</strong></p>
    </header>
    {currentNeedsLink && <div className="account-current-room">
      <div><ShieldCheck size={21} aria-hidden="true" /><span><strong>Keep access to this room</strong><span>Save {currentSession.code} to your account.</span></span></div>
      <button type="button" className="account-secondary" disabled={busy} onClick={linkCurrentRoom}>{operation === "link" ? "Saving…" : "Save this room"}</button>
    </div>}
    <div className="account-list-heading"><h3>Saved rooms {!loading && !loadError && <span>{rooms.length}</span>}</h3><button type="button" className="account-icon-button" aria-label="Refresh saved rooms" disabled={loading || busy} onClick={refresh}><RefreshCw size={17} className={loading ? "account-spinner" : ""} /></button></div>
    {loading ? <div className="account-list-status" role="status"><LoaderCircle size={21} className="account-spinner" aria-hidden="true" />Loading your auctions…</div>
      : loadError ? <div className="account-list-status is-error" role="alert"><p>{loadError}</p><button type="button" className="account-secondary" onClick={refresh} disabled={busy}>Try again</button></div>
      : rooms.length ? <ul className="account-room-list">{rooms.map(room => {
        const status = room.endedAt ? "Completed" : room.auctionPausedAt ? "Paused" : "Open";
        const role = room.role === "auctioneer" ? "Auctioneer" : room.role === "spectator" ? "Spectator" : room.teamName ?? room.teamId?.toUpperCase() ?? "Team manager";
        return <li key={room.code} className="account-room">
          <div className="account-room-identity">
            <span className="account-room-emblem" aria-hidden="true">{room.teamId ? <TeamCrest team={{ id: room.teamId, name: room.teamName ?? room.teamId, shortName: room.teamId.toUpperCase() }} /> : room.role === "auctioneer" ? <Gavel size={25} strokeWidth={1.5} /> : <Users size={25} strokeWidth={1.5} />}</span>
            <div><h4>{room.name}</h4><p>{role}<span aria-hidden="true">·</span>{room.code}</p></div>
          </div>
          <div className="account-room-actions">
            <span className={`account-room-status is-${status.toLowerCase()}`}>{room.endedAt ? <Trophy size={13} aria-hidden="true" /> : room.auctionPausedAt ? <Pause size={13} aria-hidden="true" /> : <span className="account-status-dot" aria-hidden="true" />}{status}</span>
            <button type="button" className="account-room-resume" onClick={() => resume(room)} disabled={busy} aria-label={`${room.endedAt ? "View results for" : "Return to"} ${room.name}`}>{operation === room.code ? <LoaderCircle className="account-spinner" size={17} aria-hidden="true" /> : null}{room.endedAt ? "View results" : "Return to room"}{operation !== room.code && <ChevronRight size={16} aria-hidden="true" />}</button>
          </div>
        </li>;
      })}</ul> : <div className="account-empty"><Gavel size={31} strokeWidth={1.25} aria-hidden="true" /><h3>Your next auction starts here.</h3><p>Create or join a room while signed in to save it here.</p></div>}
    {error && <p className="account-feedback is-error" role="alert">{error}</p>}
    {feedback && <p className="account-feedback" role="status"><Check size={17} aria-hidden="true" />{feedback}</p>}
    <div className="account-browser-import">
      <p>Played on this browser before signing in?</p>
      <button type="button" className="account-text-button" onClick={importBrowserRooms} disabled={busy || loading || !!loadError}><Download size={17} aria-hidden="true" />{operation === "import" ? "Saving your rooms…" : "Save rooms from this browser"}</button>
    </div>
    <footer className="account-footer"><span><ShieldCheck size={16} aria-hidden="true" />Synced to your account</span><button type="button" className="account-text-button" disabled={busy} onClick={signOut}><LogOut size={17} aria-hidden="true" />{operation === "logout" ? "Signing out…" : "Sign out"}</button></footer>
  </section>;
}
