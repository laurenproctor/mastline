"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AssetInspector, type InspectorAsset } from "./asset-inspector";
import { ContactSheet, type SheetAsset } from "./contact-sheet";
import { MetadataPanel, type MetadataPanelData } from "./metadata-panel";
import { Badge } from "./primitives";
import { generateForShootAction } from "@/app/[workspace]/shoots/metadata-actions";

/**
 * Joins the contact sheet to the two panels that describe one frame.
 *
 * The focused frame drives both, so culling, captioning, and reviewing what
 * Mastline suggested are one motion rather than three screens. The two panels
 * are tabs rather than a single long column because they answer different
 * questions -- "is this ready to send?" and "is this description true?" -- and
 * a photographer on a card is usually doing one of them at a time.
 *
 * Previous and next move the focus rather than navigating, which is what makes
 * Save and next in the metadata panel cost nothing: the whole shoot is already
 * rendered.
 */

type Tab = "dispatch" | "metadata";

export function ShootWorkspace({
  workspaceSlug,
  shootId,
  sheetAssets,
  inspectorAssets,
  panels,
  shootLocationName,
  generationAvailable = false,
  canEdit = false,
  pendingCount = 0,
  ungeneratedCount = 0,
}: {
  workspaceSlug: string;
  shootId: string;
  sheetAssets: readonly SheetAsset[];
  inspectorAssets: readonly InspectorAsset[];
  /** One entry per photograph, keyed by asset id. Built on the server. */
  panels: Readonly<Record<string, MetadataPanelData>>;
  /** Inherited into a frame that has no location of its own. */
  shootLocationName?: string;
  /** False when this deployment has no generation service configured. */
  generationAvailable?: boolean;
  canEdit?: boolean;
  /** Photographs with a job queued or running right now. */
  pendingCount?: number;
  /** Photographs nothing has been suggested for yet. */
  ungeneratedCount?: number;
}) {
  const [focusedId, setFocusedId] = useState<string | undefined>(sheetAssets[0]?.id);
  const [tab, setTab] = useState<Tab>("dispatch");
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const router = useRouter();

  const order = useMemo(() => sheetAssets.map((asset) => asset.id), [sheetAssets]);
  const position = focusedId ? order.indexOf(focusedId) : -1;

  const focused = inspectorAssets.find((asset) => asset.id === focusedId) ?? inspectorAssets[0];
  const panel = focused ? panels[focused.id] : undefined;

  const reviewed = useMemo(
    () => Object.values(panels).filter((entry) => entry.status.status === "confirmed").length,
    [panels],
  );

  const move = useCallback(
    (delta: number) => {
      if (position < 0) return;
      const next = order[position + delta];
      if (next) setFocusedId(next);
    },
    [order, position],
  );

  const generateAll = useCallback(async () => {
    setBulkRunning(true);
    setBulkNote(null);
    try {
      const result = await generateForShootAction(workspaceSlug, { shootId, includeFailed: true });
      setBulkNote(result.message);
      router.refresh();
    } finally {
      setBulkRunning(false);
    }
  }, [router, shootId, workspaceSlug]);

  return (
    <div className="shoot-layout">
      <div>
        <ContactSheet
          workspaceSlug={workspaceSlug}
          assets={sheetAssets}
          onFocusAsset={setFocusedId}
          shootId={shootId}
        />

        {canEdit && generationAvailable && (ungeneratedCount > 0 || pendingCount > 0) && (
          <div className="dark-toolbar">
            <span className="muted">
              {pendingCount > 0
                ? `${pendingCount} being read now`
                : `${ungeneratedCount} ${ungeneratedCount === 1 ? "photograph has" : "photographs have"} no suggestion yet`}
            </span>
            <div className="actions">
              {bulkNote && (
                <span className="muted" role="status">
                  {bulkNote}
                </span>
              )}
              <button
                className="button small"
                disabled={bulkRunning || ungeneratedCount === 0}
                onClick={() => void generateAll()}
                type="button"
              >
                {bulkRunning ? "Queueing…" : `Generate for ${ungeneratedCount}`}
              </button>
            </div>
          </div>
        )}
      </div>

      <aside aria-label="Photograph inspector" className="panel">
        <div className="panel-head">
          <h2>Inspector</h2>
          {focused ? null : <Badge tone="neutral">No frames</Badge>}
        </div>

        {focused ? (
          <>
            <div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
              <button
                aria-selected={tab === "dispatch"}
                className={`button small${tab === "dispatch" ? " acid" : ""}`}
                onClick={() => setTab("dispatch")}
                role="tab"
                type="button"
              >
                Dispatch fields
              </button>
              <button
                aria-selected={tab === "metadata"}
                className={`button small${tab === "metadata" ? " acid" : ""}`}
                onClick={() => setTab("metadata")}
                role="tab"
                type="button"
              >
                Photograph metadata
                {panel && panel.status.status === "needs_review" ? (
                  <span aria-label=", needs review" className="tab-dot" />
                ) : null}
              </button>
            </div>

            {tab === "dispatch" ? (
              <AssetInspector
                workspaceSlug={workspaceSlug}
                asset={focused}
                shootId={shootId}
                shootLocationName={shootLocationName}
              />
            ) : panel ? (
              <MetadataPanel
                {...panel}
                canEdit={canEdit}
                generationAvailable={generationAvailable}
                navigation={{
                  position: position + 1,
                  total: order.length,
                  reviewed,
                  onPrevious: position > 0 ? () => move(-1) : undefined,
                  onNext: position >= 0 && position < order.length - 1 ? () => move(1) : undefined,
                }}
                shootId={shootId}
                workspaceSlug={workspaceSlug}
              />
            ) : (
              <p className="empty-sheet">
                This photograph has no metadata record yet. It is created on import; one from an
                earlier import gets one the first time you generate.
              </p>
            )}
          </>
        ) : (
          <p className="empty-sheet">Import files to start captioning.</p>
        )}
      </aside>
    </div>
  );
}
