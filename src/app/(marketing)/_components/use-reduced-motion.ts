"use client";

import { useEffect, useState } from "react";

/**
 * Respect the visitor's motion setting, and re-check if they change it.
 *
 * Lifted out of behaviors.tsx once the pages beneath the home page grew
 * demonstrations of their own. One definition means one answer: a reader who
 * asks for less motion gets the same treatment from the pitch link, the
 * lifecycle chain and the detection demo as they already got from the hero.
 *
 * It reports false on the first render, because the preference is not known
 * until the effect runs. Anything that would animate immediately should key
 * off it rather than start and then be told to stop.
 */
export function usePrefersReducedMotion(): boolean {
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
