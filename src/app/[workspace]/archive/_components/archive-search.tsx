"use client";

import { useEffect, useRef } from "react";
import styles from "../archive.module.css";
import { SearchIcon } from "./archive-icons";

/**
 * The search field: the primary way into the archive.
 *
 * A plain GET form, so a search is an address that can be shared, bookmarked,
 * and returned to with the back button, and so it works before any script has
 * loaded. The one thing the script adds is the "/" shortcut, which puts the
 * cursor in the field from anywhere on the page.
 *
 * The search itself happens in the database, through the same function as
 * before: this component changes how the field looks, not what it matches.
 */
export function ArchiveSearch({
  query,
  hidden,
}: {
  query: string;
  /** State the search should carry through: the commercial filter, the view. */
  hidden: Readonly<Record<string, string | undefined>>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form aria-label="Archive search" className={styles.search} method="get" role="search">
      {Object.entries(hidden).map(([name, value]) =>
        value ? <input key={name} name={name} type="hidden" value={value} /> : null,
      )}
      <div className={styles.searchRow}>
        <div className={styles.searchField}>
          <span className={styles.searchIcon}>
            <SearchIcon />
          </span>
          <label className={styles.srOnly} htmlFor="archive-search">
            Search the archive
          </label>
          <input
            aria-describedby="archive-search-hint"
            aria-keyshortcuts="/"
            autoComplete="off"
            className={styles.searchInput}
            defaultValue={query}
            enterKeyHint="search"
            id="archive-search"
            name="q"
            placeholder="Search your archive…"
            ref={inputRef}
            type="search"
          />
          <kbd aria-hidden="true" className={styles.kbd}>
            /
          </kbd>
        </div>
        <button className={`button primary ${styles.searchButton}`} type="submit">
          Search
        </button>
      </div>
      <p className={styles.searchHint} id="archive-search-hint">
        Matches headlines, captions, places, subjects, keywords, credits, and filenames. Searched in
        the database, not in the browser.
      </p>
    </form>
  );
}
