"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AudioLines, Volume2, VolumeX, X } from "lucide-react";
import { AuctionAudioEngine, DEFAULT_SOUND_PREFERENCES, LiveAuctionSoundTracker, parseSoundPreferences, SOUND_STORAGE_KEY, type AuctionSound, type SoundActivity, type SoundPreferences } from "@/lib/auction-audio";
import "./sound-controls.css";

/** Call once in the room; route all confirmed snapshots here, even while sound is muted. */
export function useAuctionAudio({ roomId, activity, connected }: { roomId: string; activity: readonly SoundActivity[]; connected: boolean }) {
  const [preferences, setPreferences] = useState<SoundPreferences>(DEFAULT_SOUND_PREFERENCES);
  const [unavailable, setUnavailable] = useState(false);
  const engine = useRef<AuctionAudioEngine | null>(null);
  const tracker = useRef<LiveAuctionSoundTracker | null>(null);
  const preferenceRef = useRef(preferences);

  useEffect(() => {
    engine.current = new AuctionAudioEngine();
    tracker.current = new LiveAuctionSoundTracker();
    let saved = { ...DEFAULT_SOUND_PREFERENCES };
    try { saved = parseSoundPreferences(localStorage.getItem(SOUND_STORAGE_KEY)); } catch {}
    preferenceRef.current = saved;
    engine.current.setPreferences(saved);
    // Loading preferences is synchronization with an external browser store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreferences(saved);
    const unlock = (event: Event) => {
      if (event.isTrusted && preferenceRef.current.enabled) void engine.current?.unlock();
    };
    const syncPreferences = (event: StorageEvent) => {
      if (event.key !== SOUND_STORAGE_KEY) return;
      const next = parseSoundPreferences(event.newValue);
      preferenceRef.current = next;
      engine.current?.setPreferences(next);
      setPreferences(next);
    };
    document.addEventListener("pointerdown", unlock, { capture: true });
    document.addEventListener("keydown", unlock, { capture: true });
    window.addEventListener("storage", syncPreferences);
    return () => {
      document.removeEventListener("pointerdown", unlock, { capture: true });
      document.removeEventListener("keydown", unlock, { capture: true });
      window.removeEventListener("storage", syncPreferences);
      engine.current?.dispose();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    const sounds = tracker.current?.observe(roomId, activity, connected && !document.hidden) ?? [];
    for (const sound of sounds) engine.current?.play(sound);
  }, [roomId, activity, connected]);

  const updatePreferences = useCallback((next: SoundPreferences) => {
    preferenceRef.current = next;
    setPreferences(next);
    engine.current?.setPreferences(next);
    try { localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(next)); } catch {}
  }, []);

  const toggle = useCallback(async () => {
    const next = { ...preferenceRef.current, enabled: !preferenceRef.current.enabled };
    updatePreferences(next);
    if (next.enabled) {
      const available = await engine.current?.unlock();
      setUnavailable(!available);
      if (available) engine.current?.play("bid");
    }
  }, [updatePreferences]);

  const setVolume = useCallback((volume: number) => updatePreferences({ ...preferenceRef.current, volume }), [updatePreferences]);
  const play = useCallback((sound: AuctionSound) => { engine.current?.play(sound); }, []);
  return { ...preferences, unavailable, toggle, setVolume, play };
}

export type AuctionAudioControls = ReturnType<typeof useAuctionAudio>;

export function SoundControls({ sound }: { sound: AuctionAudioControls }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  return <div className="auction-sound" ref={root}>
    <button className={`sound-trigger ${sound.enabled ? "sound-enabled" : ""}`} type="button" ref={trigger} aria-expanded={open} aria-controls={`${id}-panel`} aria-label={`Auction sound ${sound.enabled ? "on" : "off"}. Open sound settings`} onClick={() => setOpen(value => !value)}>
      {sound.enabled ? <Volume2 size={18}/> : <VolumeX size={18}/>}<span>Sound {sound.enabled ? "on" : "off"}</span>
    </button>
    {open && <section id={`${id}-panel`} className="sound-panel" aria-label="Auction sound settings">
      <div className="sound-heading"><AudioLines size={20}/><strong>Auction sound</strong><button type="button" aria-label="Close sound settings" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={17}/></button></div>
      <button type="button" className="sound-switch" role="switch" aria-checked={sound.enabled} onClick={() => void sound.toggle()}><span>{sound.enabled ? "Sound enabled" : "Enable sound"}</span><i aria-hidden="true"><b/></i></button>
      <label className="sound-volume" htmlFor={`${id}-volume`}><span>Volume <output>{Math.round(sound.volume * 100)}%</output></span><input id={`${id}-volume`} type="range" min="0" max="100" step="1" value={Math.round(sound.volume * 100)} onChange={event => sound.setVolume(Number(event.target.value) / 100)} disabled={!sound.enabled}/></label>
      {sound.unavailable && <p className="sound-error" role="status">Audio isn’t available in this browser. The auction still works normally.</p>}
    </section>}
  </div>;
}
