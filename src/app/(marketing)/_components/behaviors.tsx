"use client";

import { useEffect, useState } from "react";
import { SALES_ENGINE_PHOTOGRAPHER_RATE, SALES_ENGINE_PLATFORM_RATE } from "@/lib/sales-engine";

/**
 * The five pieces of the marketing site that move.
 *
 * These attach behaviour to markup that is already server-rendered, rather than
 * owning it. The design was authored as one HTML file with a script that walks
 * the DOM; keeping that shape means the pages stay static and the visual result
 * is the artifact's, not an approximation of it re-typed into JSX.
 *
 * Two of them are not decoration. The reawakening card and the money card hide
 * content behind a class the script adds, so without this the pitch panel and
 * the running total would never appear at all. A third, the dates, is why the
 * night's takings used to be paid on a day in the past.
 */

const money = (n: number) => Math.round(n).toLocaleString("en-US");

/** Respect the visitor's motion setting, and re-check if they change it. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/**
 * The archive "reawakening" demo: a headline types itself, dormant frames light
 * up one by one, and a pitch card resolves. Without it the pitch card stays at
 * opacity 0 for ever, because `.rw.done` is what reveals it.
 */
export function ArchiveReawakening() {
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const root = document.getElementById("rw");
    const headline = document.getElementById("rwHeadline");
    const replay = document.getElementById("rwReplay");
    if (!root || !headline) return;

    const tiles = Array.from(root.querySelectorAll<HTMLElement>(".rw-tile.m"));
    const text = headline.dataset.headline ?? headline.textContent ?? "";
    let timers: ReturnType<typeof setTimeout>[] = [];
    let playing = false;

    const clear = () => {
      timers.forEach(clearTimeout);
      timers = [];
    };
    const reset = () => {
      clear();
      playing = false;
      root.classList.remove("done");
      headline.textContent = "";
      tiles.forEach((tile) => tile.classList.remove("lit"));
    };
    const finish = () => {
      headline.textContent = text;
      tiles.forEach((tile) => tile.classList.add("lit"));
      root.classList.add("done");
      playing = false;
    };
    const play = () => {
      if (playing) return;
      reset();
      playing = true;
      if (reduced) return finish();

      let index = 0;
      const type = () => {
        if (index <= text.length) {
          headline.textContent = text.slice(0, index);
          index += 1;
          timers.push(setTimeout(type, 28));
        } else {
          timers.push(setTimeout(light, 500));
        }
      };
      const light = () => {
        tiles.forEach((tile, position) => {
          timers.push(setTimeout(() => tile.classList.add("lit"), position * 520));
        });
        timers.push(
          setTimeout(
            () => {
              root.classList.add("done");
              playing = false;
            },
            tiles.length * 520 + 500,
          ),
        );
      };
      timers.push(setTimeout(type, 300));
    };

    const onReplay = () => {
      reset();
      timers.push(setTimeout(play, 150));
    };
    replay?.addEventListener("click", onReplay);

    // Play when it is looked at, and rearm when it leaves, so scrolling back to
    // it shows the demonstration again rather than a card that has already
    // finished. The threshold is low because the card is tall: at 0.4 a short
    // window never sees enough of it at once and nothing ever starts.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) play();
          else if (!playing) reset();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(root);

    return () => {
      observer.disconnect();
      replay?.removeEventListener("click", onReplay);
      clear();
      // Leave the finished state behind rather than a blank card, in case the
      // effect is torn down and re-run.
      finish();
    };
  }, [reduced]);

  return null;
}

/**
 * The running total beside the night's timeline. Each step carries the figure
 * it represents, and the card counts up to whichever step you have reached.
 */
export function MoneyCounter() {
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const steps = Array.from(document.querySelectorAll<HTMLElement>(".mstep"));
    const num = document.getElementById("mNum");
    const label = document.getElementById("mLabel");
    const note = document.getElementById("mNote");
    const bar = document.getElementById("mBar");
    if (!steps.length || !num || !label || !note || !bar) return;

    const max = Math.max(...steps.map((s) => Number(s.dataset.value ?? 0)), 1);
    let current = 0;
    let target = 0;
    let frame: number | null = null;
    let active = -1;

    const tween = () => {
      const diff = target - current;
      if (Math.abs(diff) < 1 || reduced) {
        current = target;
        num.textContent = money(current);
        frame = null;
        return;
      }
      current += diff * 0.12;
      num.textContent = money(current);
      frame = requestAnimationFrame(tween);
    };

    const activate = (index: number) => {
      if (index === active) return;
      active = index;
      const step = steps[index];
      steps.forEach((el, position) => el.classList.toggle("on", position <= index));
      target = Number(step.dataset.value ?? 0);
      label.textContent = step.dataset.label ?? "";
      note.textContent = step.dataset.note ?? "";
      bar.style.width = `${(target / max) * 100}%`;
      if (frame === null) frame = requestAnimationFrame(tween);
    };

    const pick = () => {
      const line = window.innerHeight * 0.55;
      let best = 0;
      steps.forEach((step, index) => {
        if (step.getBoundingClientRect().top < line) best = index;
      });
      activate(best);
    };

    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [reduced]);

  return null;
}

/**
 * The 70/30 calculator on the pricing page.
 *
 * The rates come from src/lib/sales-engine.ts, the same module that splits a
 * real sale, so the illustration cannot drift from the arithmetic a
 * photographer is actually paid by.
 */
export function SplitCalculator() {
  useEffect(() => {
    const range = document.getElementById("pr-range") as HTMLInputElement | null;
    const out = document.getElementById("pr-out");
    const total = document.getElementById("pr-total");
    const yours = document.getElementById("pr-you");
    const ours = document.getElementById("pr-us");
    if (!range || !out || !total || !yours || !ours) return;

    const update = () => {
      const value = Number(range.value);
      out.textContent = `$${money(value)}`;
      total.textContent = `$${money(value)}`;
      yours.textContent = `$${money(value * SALES_ENGINE_PHOTOGRAPHER_RATE)}`;
      ours.textContent = `$${money(value * SALES_ENGINE_PLATFORM_RATE)}`;
    };

    update();
    range.addEventListener("input", update);
    return () => range.removeEventListener("input", update);
  }, []);

  return null;
}

/**
 * The dates in the night's story, resolved against the day the visitor is
 * reading it.
 *
 * The markup carries the intent rather than a date: `data-tomorrow` means one
 * day from now, and `data-days` moves it further out -- the invoice in the
 * ticker is paid tomorrow, the archive resale and the running total land three
 * days after. `data-tomorrow="upper"` matches the ticker's uppercase timestamps.
 *
 * The literal in the JSX is only what a visitor sees before this runs, so the
 * date is deliberately computed here and not on the server: these pages are
 * prerendered once at build time, and a date baked in then is wrong by the next
 * morning. It is also the visitor's own local day, which is the point of a
 * ticker claiming to be tonight.
 */
export function RelativeDates() {
  useEffect(() => {
    const plus = (days: number) => {
      const date = new Date();
      date.setDate(date.getDate() + days);
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    for (const el of document.querySelectorAll<HTMLElement>("[data-tomorrow]")) {
      const days = Number(el.dataset.days ?? 1);
      const text = plus(Number.isFinite(days) ? days : 1);
      el.textContent = el.dataset.tomorrow === "upper" ? text.toUpperCase() : text;
    }
  }, []);

  return null;
}

/**
 * The hero: a screenshot lying back in 3D that stands up as you scroll, with
 * four cards floating in front of it.
 *
 * `.hero .stage .shot` is parked at `rotateX(22deg) scale(.94)` in the
 * stylesheet, which is the *start* of the movement, not a pose. Without this
 * the screenshot stays tipped away from the reader for ever and the cards never
 * settle, which reads as a broken image rather than a still one.
 *
 * Progress runs 0 to 1 as the stage travels from just below the fold to the
 * upper third of the viewport, smoothed with a smoothstep so it eases at both
 * ends. The pointer adds a small parallax on top, chased rather than followed so
 * it glides; each card leans by its own `data-depth` and `data-rot`.
 *
 * The artifact also animated the screenshot's shadow. That is dropped: this
 * direction clears every shadow with `* { box-shadow: none !important }`, which
 * an inline style cannot outrank, so the line would have done nothing.
 */
export function HeroStage() {
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const stage = document.getElementById("stage");
    const shot = document.getElementById("heroShot");
    if (!stage || !shot || reduced) return;

    const floats = [...stage.querySelectorAll<HTMLElement>(".float")];
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    // Where the pointer is, and where the animation has caught up to.
    let wantX = 0;
    let wantY = 0;
    let atX = 0;
    let atY = 0;
    let queued = false;

    const render = () => {
      queued = false;
      const { top } = stage.getBoundingClientRect();
      const viewport = window.innerHeight || 800;
      const progress = clamp(1 - (top - viewport * 0.15) / (viewport * 0.75), 0, 1);
      const eased = progress * progress * (3 - 2 * progress);

      atX += (wantX - atX) * 0.08;
      atY += (wantY - atY) * 0.08;

      const rotateX = 22 - 22 * eased + atY * -4;
      const rotateY = atX * 6 * (1 - eased * 0.6);
      const scale = 0.94 + 0.06 * eased;
      const lift = (1 - eased) * 12;
      shot.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale}) translateY(${lift}px)`;

      for (const float of floats) {
        const depth = Number(float.dataset.depth) || 1;
        const tilt = Number(float.dataset.rot) || 0;
        const y = (1 - eased) * 90 * depth + eased * -18 * depth + atY * 10 * depth;
        const z = 40 * depth * eased;
        float.style.transform = `translate3d(${atX * 14 * depth}px, ${y}px, ${z}px) rotateZ(${tilt * (1 - eased * 0.7)}deg) rotateX(${(1 - eased) * 14}deg)`;
        float.style.opacity = String(clamp(0.35 + eased * 0.65, 0, 1));
      }

      // Keep going while the pointer parallax is still catching up.
      if (Math.abs(wantX - atX) > 0.001 || Math.abs(wantY - atY) > 0.001) request();
    };

    const request = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(render);
    };

    const track = (event: PointerEvent) => {
      wantX = (event.clientX / window.innerWidth - 0.5) * 2;
      wantY = (event.clientY / window.innerHeight - 0.5) * 2;
      request();
    };

    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    window.addEventListener("pointermove", track, { passive: true });
    request();

    return () => {
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
      window.removeEventListener("pointermove", track);
    };
  }, [reduced]);

  return null;
}
