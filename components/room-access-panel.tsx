"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, ShieldCheck, Trash2, X } from "lucide-react";
import { AuctionRequestError, requestAuction } from "@/lib/auction-client";
import "./room-access-panel.css";

type RoomAccessProps = { code: string; token: string; onDeleted: () => void };
type PasswordState = { status: "loading" } | { status: "ready"; password: string } | { status: "error"; message: string };

/** The server independently verifies creator access for both private endpoints. */
export function RoomAccessPanel(props: RoomAccessProps) {
  // A different room or identity must never inherit a previously revealed secret.
  return <CreatorControls key={`${props.code}:${props.token}`} {...props} />;
}

function CreatorControls({ code, token, onDeleted }: RoomAccessProps) {
  const [passwordState, setPasswordState] = useState<PasswordState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [deleting, setDeleting] = useState(false);
  const titleId = useId();
  const passwordId = useId();
  const helpId = useId();

  useEffect(() => {
    const controller = new AbortController();
    requestAuction<{ teamPassword: string }>(`/api/rooms/${code}/access`, {}, token, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        if (typeof response.teamPassword !== "string" || !response.teamPassword) {
          setPasswordState({ status: "error", message: "The team password could not be loaded. Try again." });
          return;
        }
        setPasswordState({ status: "ready", password: response.teamPassword });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setPasswordState({ status: "error", message: cause instanceof Error ? cause.message : "The team password could not be loaded. Try again." });
      });
    return () => controller.abort();
  }, [code, token, attempt]);

  async function copyPassword() {
    if (passwordState.status !== "ready") return;
    setCopyStatus("idle");
    try {
      await navigator.clipboard.writeText(passwordState.password);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return <section className="manage-panel room-access-panel" aria-labelledby={titleId}>
    <div className="room-access-heading">
      <div className="room-access-icon"><ShieldCheck size={22} aria-hidden="true" /></div>
      <div><h2 id={titleId}>Room access</h2><p>Only you, the room creator, can view these controls.</p></div>
    </div>
    <div className="room-access-content">
      <div className="room-access-description">
        <h3><KeyRound size={18} aria-hidden="true" />Team join password</h3>
        <p id={helpId}>Anyone with the room code can watch as a spectator. Share this password privately with people you want to claim a team.</p>
      </div>
      <div className="room-access-password-area">
        {passwordState.status === "loading" && <p className="room-access-loading" role="status">Loading your team password…</p>}
        {passwordState.status === "error" && <>
          <p className="manage-error" role="alert">{passwordState.message}</p>
          <button type="button" className="manage-button" onClick={() => { setPasswordState({ status: "loading" }); setAttempt((value) => value + 1); }}>Retry password load</button>
        </>}
        {passwordState.status === "ready" && <>
          <label className="room-access-password-label" htmlFor={passwordId}>Team password</label>
          <div className="room-access-password">
            <input id={passwordId} type={revealed ? "text" : "password"} value={passwordState.password} readOnly autoComplete="off" spellCheck={false} aria-describedby={helpId} />
            <button type="button" className="room-access-reveal" aria-label={revealed ? "Hide team password" : "Show team password"} aria-pressed={revealed} onClick={() => setRevealed((value) => !value)}>{revealed ? <EyeOff size={19} /> : <Eye size={19} />}</button>
          </div>
          <div className="room-access-password-actions">
            <button type="button" className="manage-button" onClick={copyPassword}>{copyStatus === "copied" ? <Check size={16} /> : <Copy size={16} />}{copyStatus === "copied" ? "Password copied" : "Copy password"}</button>
            <span>Invite links never include this password.</span>
          </div>
          <p className="room-access-copy-status" role="status">{copyStatus === "failed" ? "Copy is unavailable. Reveal the password, then select and copy it manually." : copyStatus === "copied" ? "Copied. Share it only with your team owners." : ""}</p>
        </>}
      </div>
    </div>
    <div className="room-access-delete">
      <div><h3>Delete this auction room</h3><p>Permanently remove this room and its auction history. Your common player pool will stay intact.</p></div>
      <button type="button" className="manage-button room-access-delete-button" onClick={() => setDeleting(true)}><Trash2 size={17} />Delete room</button>
    </div>
    {deleting && <DeleteRoomDialog code={code} token={token} onDeleted={onDeleted} onClose={() => setDeleting(false)} />}
  </section>;
}

function DeleteRoomDialog({ code, token, onDeleted, onClose }: RoomAccessProps & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  const confirmationMatches = confirmation.trim().toUpperCase() === code;

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !confirmationMatches) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await requestAuction<{ deleted: boolean }>(`/api/rooms/${code}/delete`, { confirmationCode: code }, token);
      if (response.deleted !== true) throw new AuctionRequestError("Deletion could not be confirmed.", undefined, "INVALID_RESPONSE");
      onDeleted();
    } catch (cause) {
      const unconfirmed = cause instanceof AuctionRequestError && ["REQUEST_TIMEOUT", "NETWORK_ERROR", "INVALID_RESPONSE"].includes(cause.code ?? "");
      setError(unconfirmed ? "We could not confirm whether the room was deleted. Retry to safely confirm the result." : cause instanceof Error ? cause.message : "The room could not be deleted. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return <dialog ref={dialog} className="manage-dialog room-delete-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); if (!busyRef.current) onClose(); }}>
    <div className="manage-dialog-head"><div><h2 id={titleId}>Delete auction room?</h2><p id={descriptionId}>This permanently deletes all bids, purchases and squads in this room, and disconnects everyone. The common player pool is kept. This cannot be undone.</p></div><button type="button" className="manage-icon-button" aria-label="Close delete confirmation" disabled={busy} onClick={onClose}><X size={20} /></button></div>
    <form className="manage-form" onSubmit={remove}>
      <label className="manage-field room-delete-confirmation"><span>Type <strong>{code}</strong> to confirm deletion</span><input type="text" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} required disabled={busy} maxLength={12} placeholder="Room code" /></label>
      {error && <p className="manage-error" role="alert">{error}</p>}
      <div className="manage-dialog-actions"><button type="button" className="manage-button" disabled={busy} onClick={onClose}>Keep room</button><button type="submit" className="manage-button manage-danger" disabled={busy || !confirmationMatches}><Trash2 size={17} />{busy ? "Deleting…" : "Permanently delete"}</button></div>
    </form>
  </dialog>;
}
