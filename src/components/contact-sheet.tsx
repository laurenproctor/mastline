"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setRatingAction, setSelectionAction } from "@/app/[workspace]/shoots/actions";
import { workspaceRoutes } from "@/lib/workspace-routes";

export interface SheetAsset {
  readonly id: string;
  readonly filename: string;
  readonly selected: boolean;
  readonly rating?: number;
  readonly previewUrl?: string;
  readonly missingRequired: readonly string[];
  readonly capturedAt?: string;
}

type Filter = "all" | "selected" | "warnings";

/**
 * The contact sheet.
 *
 * Culling is the highest-volume thing an operator does, so it is built for the
 * keyboard first: arrows move, space selects, 0-5 rate, A selects all, and
 * shift-click extends a range. Every shortcut has a visible control too, and
 * the focused frame is announced.
 */
export function ContactSheet({
  workspaceSlug,
  shootId,
  assets,
  onFocusAsset,
}: {
  workspaceSlug: string;
  shootId: string;
  assets: readonly SheetAsset[];
  onFocusAsset?: (assetId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [focusIndex, setFocusIndex] = useState(0);
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const gridRef = useRef<HTMLUListElement>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const visible = useMemo(() => {
    if (filter === "selected") return assets.filter((asset) => asset.selected);
    if (filter === "warnings") return assets.filter((asset) => asset.missingRequired.length > 0);
    return assets;
  }, [assets, filter]);

  const focused = visible[Math.min(focusIndex, visible.length - 1)];

  useEffect(() => {
    if (focused && onFocusAsset) onFocusAsset(focused.id);
  }, [focused, onFocusAsset]);

  const mutate = useCallback(
    async (ids: string[], selected: boolean) => {
      if (ids.length === 0) return;
      setPendingIds(new Set(ids));
      await setSelectionAction(workspaceSlug, { shootId, assetIds: ids, selected });
      setPendingIds(new Set());
      startTransition(() => router.refresh());
    },
    /*
     * workspaceSlug belongs here. Without it, a callback captured on first
     * render kept whichever address was current then, and the client router
     * re-uses this component across a workspace change -- so a stale closure
     * would have written a selection into the workspace the operator had left.
     * The action re-resolves membership from the slug it is handed, so the
     * write would have been refused rather than misfiled, but a refused write
     * on a screen that looks fine is its own kind of wrong.
     */
    [router, shootId, workspaceSlug],
  );

  const toggle = useCallback(
    (asset: SheetAsset) => void mutate([asset.id], !asset.selected),
    [mutate],
  );

  const selectRange = useCallback(
    (from: number, to: number, selected: boolean) => {
      const [start, end] = from <= to ? [from, to] : [to, from];
      const ids = visible.slice(start, end + 1).map((asset) => asset.id);
      void mutate(ids, selected);
    },
    [mutate, visible],
  );

  const rate = useCallback(
    async (asset: SheetAsset, rating: number) => {
      await setRatingAction(workspaceSlug, {
        shootId,
        assetId: asset.id,
        rating: asset.rating === rating ? null : rating,
      });
      startTransition(() => router.refresh());
    },
    [router, shootId, workspaceSlug],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (visible.length === 0) return;
      const columns = 5;
      let next = focusIndex;

      switch (event.key) {
        case "ArrowRight":
          next = Math.min(focusIndex + 1, visible.length - 1);
          break;
        case "ArrowLeft":
          next = Math.max(focusIndex - 1, 0);
          break;
        case "ArrowDown":
          next = Math.min(focusIndex + columns, visible.length - 1);
          break;
        case "ArrowUp":
          next = Math.max(focusIndex - columns, 0);
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = visible.length - 1;
          break;
        case " ":
        case "Enter":
          event.preventDefault();
          if (focused) toggle(focused);
          return;
        case "a":
        case "A":
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            void mutate(
              visible.map((asset) => asset.id),
              true,
            );
          }
          return;
        default:
          if (/^[0-5]$/.test(event.key) && focused) {
            event.preventDefault();
            void rate(focused, Number(event.key));
          }
          return;
      }

      event.preventDefault();
      setFocusIndex(next);
      const node = gridRef.current?.querySelectorAll<HTMLElement>("[data-frame]")[next];
      node?.focus();
    },
    [focusIndex, focused, mutate, rate, toggle, visible],
  );

  const selectedCount = assets.filter((asset) => asset.selected).length;
  const warningCount = assets.filter((asset) => asset.missingRequired.length > 0).length;

  return (
    <div>
      <div className="dark-toolbar">
        <div className="actions" role="group" aria-label="Filter frames">
          {(
            [
              ["all", `All ${assets.length}`],
              ["selected", `Selected ${selectedCount}`],
              ["warnings", `Warnings ${warningCount}`],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={filter === value}
              className={`button small${filter === value ? " acid" : ""}`}
              key={value}
              onClick={() => {
                setFilter(value);
                setFocusIndex(0);
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="actions">
          <button
            className="button small"
            onClick={() =>
              void mutate(
                visible.map((asset) => asset.id),
                true,
              )
            }
            type="button"
          >
            Select all
          </button>
          <button
            className="button small"
            onClick={() =>
              void mutate(
                visible.filter((asset) => asset.selected).map((asset) => asset.id),
                false,
              )
            }
            type="button"
          >
            Clear
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="empty-sheet">
          {assets.length === 0
            ? "No files imported yet."
            : filter === "warnings"
              ? "Nothing is missing required metadata."
              : "No frames are selected."}
        </p>
      ) : (
        <ul aria-label="Contact sheet" className="photo-grid" onKeyDown={onKeyDown} ref={gridRef}>
          {visible.map((asset, index) => {
            const isPending = pendingIds.has(asset.id);
            const warning = asset.missingRequired.length > 0;
            return (
              <li key={asset.id}>
                <div
                  aria-label={`${asset.filename}${asset.selected ? ", selected" : ""}${
                    warning ? `, missing ${asset.missingRequired.join(", ")}` : ""
                  }${asset.rating ? `, rated ${asset.rating}` : ""}`}
                  aria-pressed={asset.selected}
                  className={`frame${asset.selected ? " selected" : ""}${warning ? " warning" : ""}${
                    isPending ? " pending" : ""
                  }`}
                  data-frame
                  onClick={(event) => {
                    if (event.shiftKey && anchorIndex !== null) {
                      selectRange(anchorIndex, index, !asset.selected);
                    } else {
                      setAnchorIndex(index);
                      toggle(asset);
                    }
                    setFocusIndex(index);
                  }}
                  onFocus={() => setFocusIndex(index)}
                  role="button"
                  tabIndex={index === focusIndex ? 0 : -1}
                >
                  {asset.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" className="frame-image" loading="lazy" src={asset.previewUrl} />
                  ) : (
                    <span className="frame-placeholder">
                      <span aria-hidden="true">▨</span>
                      <small>No preview</small>
                    </span>
                  )}

                  <span className="frame-name">{asset.filename}</span>
                  {asset.selected && (
                    <span aria-hidden="true" className="select-mark">
                      ✓
                    </span>
                  )}
                  {warning && (
                    <span aria-hidden="true" className="warning-mark" title="Missing metadata">
                      !
                    </span>
                  )}
                  {asset.rating ? (
                    <span aria-hidden="true" className="frame-rating">
                      {"★".repeat(asset.rating)}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="dark-toolbar">
        <span className="muted">
          Arrows move · Space selects · 0–5 rates · Shift-click extends · Ctrl/Cmd-A selects all
        </span>
        {focused && (
          <Link className="button small" href={workspaceRoutes(workspaceSlug).asset(focused.id)}>
            Open record
          </Link>
        )}
      </div>
    </div>
  );
}
