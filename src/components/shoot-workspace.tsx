"use client";

import { useState } from "react";
import { AssetInspector, type InspectorAsset } from "./asset-inspector";
import { ContactSheet, type SheetAsset } from "./contact-sheet";
import { Badge } from "./primitives";

/**
 * Joins the contact sheet to the inspector.
 *
 * The focused frame drives the inspector, so culling and captioning are one
 * motion rather than two screens.
 */
export function ShootWorkspace({
  workspaceSlug,
  shootId,
  sheetAssets,
  inspectorAssets,
  shootLocationName,
  suggestionsAvailable = false,
}: {
  workspaceSlug: string;
  shootId: string;
  sheetAssets: readonly SheetAsset[];
  inspectorAssets: readonly InspectorAsset[];
  /** Inherited into a frame that has no location of its own. */
  shootLocationName?: string;
  /** False when this deployment has no suggestion service configured. */
  suggestionsAvailable?: boolean;
}) {
  const [focusedId, setFocusedId] = useState<string | undefined>(sheetAssets[0]?.id);
  const focused = inspectorAssets.find((asset) => asset.id === focusedId) ?? inspectorAssets[0];

  return (
    <div className="shoot-layout">
      <div>
        <ContactSheet workspaceSlug={workspaceSlug} assets={sheetAssets} onFocusAsset={setFocusedId} shootId={shootId} />
      </div>

      <aside aria-label="Asset inspector" className="panel">
        <div className="panel-head">
          <h2>Asset inspector</h2>
          {focused ? null : <Badge tone="neutral">No frames</Badge>}
        </div>
        {focused ? (
          <AssetInspector
            workspaceSlug={workspaceSlug}
            asset={focused}
            shootId={shootId}
            shootLocationName={shootLocationName}
            suggestionsAvailable={suggestionsAvailable}
          />
        ) : (
          <p className="empty-sheet">Import files to start captioning.</p>
        )}
      </aside>
    </div>
  );
}
