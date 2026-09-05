"use client";

import "@/styles/mastline-dashboard-screens.css";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionLink, Button } from "@/components/button";
import { saveFlowSelectionAction } from "../actions";

/**
 * Stage one: choose the photographs this delivery will carry.
 *
 * The selection lives on the draft package, and every toggle is saved to it
 * before the interface claims anything: the ordinal a frame shows is its
 * stored position, a refresh renders exactly what the server holds, and
 * "Save draft" is a statement of fact rather than a button, because there is
 * nothing unsaved to press it for.
 *
 * Sends the whole ordered list on every change. Reconciliation on the server
 * means a retry converges instead of duplicating, and a request that lands
 * twice is the same selection twice.
 */

export interface SelectableFrame {
  readonly assetId: string;
  readonly filename: string;
  readonly previewUrl?: string;
  readonly capturedAt?: string;
  /** Required metadata still missing, for the quiet "needs details" note. */
  readonly missingRequired: readonly string[];
}

type Sort = "capture" | "filename";

export function PhotosStage({
  workspaceSlug,
  shootId,
  packageId,
  frames,
  memberIds,
  editable,
  continueHref,
}: {
  workspaceSlug: string;
  shootId: string;
  packageId: string;
  frames: readonly SelectableFrame[];
  /** The stored selection, in stored order. */
  memberIds: readonly string[];
  editable: boolean;
  continueHref: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [order, setOrder] = useState<readonly string[]>(memberIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("capture");
  const [focusIndex, setFocusIndex] = useState(0);
  const gridRef = useRef<HTMLUListElement>(null);
  /** The latest list handed to the server, so late responses cannot regress. */
  const inFlight = useRef(0);

  const byId = useMemo(() => new Map(frames.map((frame) => [frame.assetId, frame])), [frames]);

  const visible = useMemo(() => {
    const sorted = [...frames];
    if (sort === "capture") {
      sorted.sort((a, b) => (a.capturedAt ?? "").localeCompare(b.capturedAt ?? ""));
    } else {
      sorted.sort((a, b) => a.filename.localeCompare(b.filename));
    }
    return sorted;
  }, [frames, sort]);

  const positionOf = useMemo(() => {
    const map = new Map<string, number>();
    order.forEach((id, index) => map.set(id, index));
    return map;
  }, [order]);

  const persist = useCallback(
    async (next: readonly string[]) => {
      setOrder(next);
      setSaving(true);
      setError(null);
      const ticket = ++inFlight.current;
      const result = await saveFlowSelectionAction(workspaceSlug, {
        shootId,
        packageId,
        assetIds: [...next],
      });
      if (ticket !== inFlight.current) return;
      setSaving(false);
      if (!result.ok) {
        setError(result.error ?? "Could not save the selection.");
        startTransition(() => router.refresh());
        return;
      }
      startTransition(() => router.refresh());
    },
    [packageId, router, shootId, workspaceSlug],
  );

  const toggle = useCallback(
    (assetId: string) => {
      if (!editable) return;
      const next = positionOf.has(assetId)
        ? order.filter((id) => id !== assetId)
        : [...order, assetId];
      void persist(next);
    },
    [editable, order, persist, positionOf],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (visible.length === 0) return;
      const columns = 4;
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
        case "Enter": {
          event.preventDefault();
          const focused = visible[Math.min(focusIndex, visible.length - 1)];
          if (focused) toggle(focused.assetId);
          return;
        }
        default:
          return;
      }
      event.preventDefault();
      setFocusIndex(next);
      gridRef.current?.querySelectorAll<HTMLElement>("[data-frame]")[next]?.focus();
    },
    [focusIndex, toggle, visible],
  );

  const count = order.length;

  return (
    <div className="ml-delivery-photos">
      <div className="ml-delivery-toolbar">
        <p aria-live="polite" className="ml-delivery-toolbar__count">
          {count} selected
          {saving && <span className="ml-delivery-toolbar__saving"> · saving…</span>}
        </p>
        <label className="ml-delivery-toolbar__sort">
          Sort
          <select onChange={(event) => setSort(event.target.value as Sort)} value={sort}>
            <option value="capture">Capture time</option>
            <option value="filename">Filename</option>
          </select>
        </label>
      </div>

      {error && (
        <p className="ml-error" role="alert">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="ml-delivery-empty">
          No photographs have been imported to this shoot yet. Import frames on the shoot, then come
          back to choose which ones this delivery carries.
        </p>
      ) : (
        <ul
          aria-label="Choose photographs"
          className="ml-delivery-grid"
          onKeyDown={onKeyDown}
          ref={gridRef}
        >
          {visible.map((frame, index) => {
            const position = positionOf.get(frame.assetId);
            const selected = position !== undefined;
            const needsDetails = frame.missingRequired.length > 0;
            return (
              <li key={frame.assetId}>
                <div
                  aria-label={`${frame.filename}${
                    selected ? `, selected, position ${(position ?? 0) + 1}` : ""
                  }${needsDetails ? ", details incomplete" : ""}`}
                  aria-pressed={selected}
                  className="ml-delivery-frame"
                  data-frame
                  data-selected={selected || undefined}
                  onClick={() => {
                    setFocusIndex(index);
                    toggle(frame.assetId);
                  }}
                  onFocus={() => setFocusIndex(index)}
                  role="button"
                  tabIndex={index === focusIndex ? 0 : -1}
                >
                  <span className="ml-delivery-frame__media">
                    {frame.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" loading="lazy" src={frame.previewUrl} />
                    ) : (
                      <span className="ml-delivery-frame__blank">No preview</span>
                    )}
                    {selected && (
                      <>
                        <span aria-hidden="true" className="ml-delivery-frame__check">
                          ✓
                        </span>
                        <span aria-hidden="true" className="ml-delivery-frame__ordinal">
                          {(position ?? 0) + 1}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="ml-delivery-frame__name">{frame.filename}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="ml-delivery-flow__actions">
        <p className="ml-delivery-flow__standing">
          {count === 0
            ? "Choose at least one photograph to continue."
            : `${count} ${count === 1 ? "photograph" : "photographs"} selected · draft saved as you go`}
        </p>
        {count > 0 && (
          <ul aria-label="Selected photographs, in order" className="ml-delivery-tray">
            {order.map((id, position) => {
              const frame = byId.get(id);
              if (!frame) return null;
              return (
                <li className="ml-delivery-tray__item" key={id}>
                  {frame.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" src={frame.previewUrl} />
                  ) : (
                    <span className="ml-delivery-frame__blank">—</span>
                  )}
                  <span aria-hidden="true" className="ml-delivery-tray__ordinal">
                    {position + 1}
                  </span>
                  {editable && (
                    <button
                      aria-label={`Remove ${frame.filename} from the delivery`}
                      className="ml-delivery-tray__remove"
                      onClick={() => toggle(id)}
                      type="button"
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="ml-delivery-flow__advance">
          {count > 0 ? (
            <ActionLink href={continueHref}>Continue to details</ActionLink>
          ) : (
            <Button aria-disabled="true" disabled>
              Continue to details
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
