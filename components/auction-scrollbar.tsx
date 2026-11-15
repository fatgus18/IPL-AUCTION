"use client";

import { useEffect, useRef } from "react";
import { Gavel } from "lucide-react";

const THUMB_HEIGHT = 34;
const DESKTOP = "(hover: hover) and (pointer: fine) and (min-width: 761px) and (forced-colors: none)";

/** Native document scrolling, with one fixed-size auction hammer as its control. */
export function AuctionScrollbar() {
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rail = railRef.current;
    const thumb = thumbRef.current;
    const root = document.documentElement;
    const scroller = document.scrollingElement;
    if (!rail || !thumb || !scroller) return;

    const media = window.matchMedia(DESKTOP);
    let frame = 0;
    let pointer: number | null = null;
    let grabOffset = THUMB_HEIGHT / 2;

    const release = () => {
      if (pointer !== null && rail.hasPointerCapture(pointer)) rail.releasePointerCapture(pointer);
      pointer = null;
      delete rail.dataset.dragging;
    };

    const update = () => {
      frame = 0;
      // Install independently of overflow so changing the native gutter cannot
      // alternate between two layout widths on a page that almost fits.
      root.classList.toggle("auction-scrollbar-ready", media.matches);
      const maximum = Math.max(0, scroller.scrollHeight - root.clientHeight);
      const visible = media.matches && maximum > 1;
      rail.hidden = !visible;
      if (!visible) { release(); return; }
      const travel = Math.max(0, rail.clientHeight - THUMB_HEIGHT);
      const progress = Math.max(0, Math.min(1, scroller.scrollTop / maximum));
      thumb.style.setProperty("--scroll-thumb-y", `${progress * travel}px`);
      thumb.setAttribute("aria-valuemax", String(Math.round(maximum)));
      thumb.setAttribute("aria-valuenow", String(Math.round(progress * maximum)));
      thumb.setAttribute("aria-valuetext", `${Math.round(progress * 100)}% of page`);
    };

    // No React rerenders or continuous animation loop while scrolling.
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const moveTo = (clientY: number) => {
      const bounds = rail.getBoundingClientRect();
      const travel = Math.max(1, bounds.height - THUMB_HEIGHT);
      const progress = Math.max(0, Math.min(1, (clientY - bounds.top - grabOffset) / travel));
      window.scrollTo({ top: progress * Math.max(0, scroller.scrollHeight - root.clientHeight), behavior: "instant" });
      schedule();
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || rail.hidden || !media.matches) return;
      event.preventDefault();
      grabOffset = thumb.contains(event.target as Node) ? event.clientY - thumb.getBoundingClientRect().top : THUMB_HEIGHT / 2;
      thumb.focus({ preventScroll: true });
      pointer = event.pointerId;
      rail.setPointerCapture(pointer);
      rail.dataset.dragging = "true";
      moveTo(event.clientY);
    };
    const move = (event: PointerEvent) => { if (pointer === event.pointerId) moveTo(event.clientY); };
    const up = (event: PointerEvent) => { if (pointer === event.pointerId) release(); };
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const position = scroller.scrollTop;
      const page = root.clientHeight * 0.85;
      let target: number;
      switch (event.key) {
        case "ArrowDown": target = position + 60; break;
        case "ArrowUp": target = position - 60; break;
        case "PageDown": target = position + page; break;
        case "PageUp": target = position - page; break;
        case " ": target = position + (event.shiftKey ? -page : page); break;
        case "Home": target = 0; break;
        case "End": target = scroller.scrollHeight; break;
        default: return;
      }
      event.preventDefault();
      window.scrollTo({ top: target, behavior: "instant" });
      schedule();
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    observer.observe(rail);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    media.addEventListener("change", schedule);
    rail.addEventListener("pointerdown", down);
    rail.addEventListener("pointermove", move);
    rail.addEventListener("pointerup", up);
    rail.addEventListener("pointercancel", up);
    rail.addEventListener("lostpointercapture", up);
    thumb.addEventListener("keydown", keydown);
    update();
    return () => {
      release();
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      media.removeEventListener("change", schedule);
      rail.removeEventListener("pointerdown", down);
      rail.removeEventListener("pointermove", move);
      rail.removeEventListener("pointerup", up);
      rail.removeEventListener("pointercancel", up);
      rail.removeEventListener("lostpointercapture", up);
      thumb.removeEventListener("keydown", keydown);
      root.classList.remove("auction-scrollbar-ready");
      rail.hidden = true;
    };
  }, []);

  return <div ref={railRef} className="auction-scrollbar" hidden>
    <div ref={thumbRef} className="auction-scrollbar__thumb" role="scrollbar" aria-label="Scroll page" aria-controls="pavilion-page" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={0} aria-valuenow={0} tabIndex={0}>
      <Gavel size={25} strokeWidth={2} aria-hidden="true" />
    </div>
  </div>;
}
