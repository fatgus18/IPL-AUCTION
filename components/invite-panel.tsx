"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, KeyRound, Link2, LoaderCircle, ShieldCheck, Users } from "lucide-react";
import { requestAuction } from "@/lib/auction-client";
import "./invite-panel.css";

type InvitePanelProps = {
  code: string;
  token?: string;
  isCreator: boolean;
  ended?: boolean;
  onManagePassword?: () => void;
};

type CopyStatus = "idle" | "copying" | "copied" | "failed";

export function InvitePanel(props: InvitePanelProps) {
  // A different room or credential must never inherit a previous copy state or secret.
  return <RoomInvitation key={`${props.code}:${props.token ?? ""}:${props.isCreator}:${!!props.ended}`} {...props} />;
}

function RoomInvitation({ code, token, isCreator, ended = false, onManagePassword }: InvitePanelProps) {
  const [linkStatus, setLinkStatus] = useState<CopyStatus>("idle");
  const active = useRef(true);
  const titleId = useId();
  const linkId = useId();
  const linkStatusId = useId();
  const inviteUrl = typeof window === "undefined" ? `/?room=${code}` : `${window.location.origin}/?room=${code}`;

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function copyInviteLink() {
    if (linkStatus === "copying") return;
    setLinkStatus("copying");
    try {
      await navigator.clipboard.writeText(inviteUrl);
      if (active.current) setLinkStatus("copied");
    } catch {
      if (active.current) setLinkStatus("failed");
    }
  }

  return <section className="invitation" aria-labelledby={titleId}>
    <header className="invitation-heading">
      <span className="invitation-emblem" aria-hidden="true"><Users size={25} strokeWidth={1.5} /></span>
      <span className="invitation-overline">ROOM INVITATION</span>
      <h2 id={titleId}>Invite your league.</h2>
      <p>{ended ? "Share the completed auction and final squads." : "Bring everyone to the auction table."}</p>
    </header>

    <div className="invitation-pass">
      <div className="invitation-pass-top"><span>Room code</span><span className="invitation-pass-label"><span aria-hidden="true" />Pavilion auction</span></div>
      <strong className="invitation-room-code">{code}</strong>
      <div className="invitation-pass-rule" aria-hidden="true" />
      <label htmlFor={linkId}>Room invitation link</label>
      <div className="invitation-link-field"><Link2 size={18} aria-hidden="true" /><input id={linkId} readOnly value={inviteUrl} onFocus={event => event.currentTarget.select()} spellCheck={false} autoComplete="off" aria-describedby={linkStatusId} /></div>
      <button type="button" className="invitation-copy invitation-copy-link" onClick={copyInviteLink} disabled={linkStatus === "copying"}>
        {linkStatus === "copied" ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        {linkStatus === "copied" ? "Invite link copied" : linkStatus === "copying" ? "Copying invite link…" : linkStatus === "failed" ? "Retry copying invite link" : "Copy invite link"}
      </button>
      <p className={`invitation-feedback${linkStatus === "failed" ? " is-error" : ""}`} id={linkStatusId} role="status" aria-live="polite">
        {linkStatus === "failed" ? "Copy is unavailable. Select the invitation link above and copy it manually." : linkStatus === "copied" ? "Link copied. It is ready to share." : "Anyone with this link can join as a spectator."}
      </p>
    </div>

    {!ended && isCreator && token ? <PrivatePasswordCopy code={code} token={token} onManagePassword={onManagePassword} /> : <p className="invitation-spectator-note"><ShieldCheck size={17} aria-hidden="true" />{ended ? "Bidding has ended. New guests can view the results as spectators." : "Team managers also need the room creator’s password."}</p>}
  </section>;
}

function PrivatePasswordCopy({ code, token, onManagePassword }: { code: string; token: string; onManagePassword?: () => void }) {
  const password = useRef<string | null>(null);
  const active = useRef(true);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [attempt, setAttempt] = useState(0);
  const feedbackId = useId();

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    // Prefetch on opening the invitation so clipboard access stays inside the
    // later click's user activation, including browsers with stricter rules.
    requestAuction<{ teamPassword: string }>(`/api/rooms/${code}/access`, {}, token, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        if (typeof result.teamPassword !== "string" || !result.teamPassword) {
          setLoadStatus("failed");
          return;
        }
        password.current = result.teamPassword;
        setLoadStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadStatus("failed");
      });
    return () => {
      active.current = false;
      controller.abort();
      password.current = null;
    };
  }, [code, token, attempt]);

  async function copyPassword() {
    if (loadStatus !== "ready" || !password.current || copyStatus === "copying") return;
    setCopyStatus("copying");
    try {
      // Never render the secret into an input or hidden fallback element.
      await navigator.clipboard.writeText(password.current);
      if (active.current) setCopyStatus("copied");
    } catch {
      if (active.current) setCopyStatus("failed");
    }
  }

  function retryLoading() {
    password.current = null;
    setLoadStatus("loading");
    setCopyStatus("idle");
    setAttempt(value => value + 1);
  }

  const failed = loadStatus === "failed" || copyStatus === "failed";
  const feedback = loadStatus === "loading" ? "Preparing your private team password…"
    : loadStatus === "failed" ? "The team password could not be loaded. Retry to connect again."
    : copyStatus === "failed" ? "Clipboard access was blocked. Your password stays hidden; try copying again."
    : copyStatus === "copied" ? "Password copied. Share it privately with your team managers."
    : "Share privately with the people taking a team.";

  return <div className="invitation-private">
    <div className="invitation-private-heading"><KeyRound size={19} aria-hidden="true" /><h3>Team access</h3><span>Creator only</span></div>
    <button type="button" className="invitation-copy invitation-copy-password" onClick={loadStatus === "failed" ? retryLoading : copyPassword} disabled={loadStatus === "loading" || copyStatus === "copying"} aria-describedby={feedbackId}>
      {loadStatus === "loading" ? <LoaderCircle className="invitation-loading-icon" size={18} aria-hidden="true" /> : copyStatus === "copied" ? <Check size={18} aria-hidden="true" /> : <KeyRound size={18} aria-hidden="true" />}
      {loadStatus === "loading" ? "Preparing team password…" : loadStatus === "failed" ? "Retry password load" : copyStatus === "copied" ? "Team password copied" : copyStatus === "copying" ? "Copying team password…" : copyStatus === "failed" ? "Retry copying team password" : "Copy team password"}
    </button>
    <p id={feedbackId} className={`invitation-feedback${failed ? " is-error" : ""}`} role="status" aria-live="polite">{feedback}</p>
    {onManagePassword && <button type="button" className="invitation-manage" onClick={onManagePassword}>Manage team password<ArrowUpRight size={16} aria-hidden="true" /></button>}
  </div>;
}
