"use client";

import { useEffect, useState } from "react";
import { SALES_ENGINE_PHOTOGRAPHER_RATE, SALES_ENGINE_PLATFORM_RATE } from "@/lib/sales-engine";

/**
 * The three pieces of the marketing site that move.
 *
 * These attach behaviour to markup that is already server-rendered, rather than
 * owning it. The design was authored as one HTML file with a script that walks
 * the DOM; keeping that shape means the pages stay static and the visual result
 * is the artifact's, not an approximation of it re-typed into JSX.
 *
 * Two of them are not decoration. The reawakening card and the money card hide
 * content behind a class the script adds, so without this the pitch panel and
 * the running total would never appear at all.
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

    // Play when it is actually looked at, once.
    let seen = false;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !seen) {
            seen = true;
            play();
          }
        }
      },
      { threshold: 0.4 },
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
