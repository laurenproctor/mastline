/**
 * Dashboard information surfaces: the panels, cards, figures, lists, tables,
 * and empty states a screen is assembled from, on the design system's
 * vocabulary. Import from here; each module also loads the stylesheet it
 * needs, so a deep import works too.
 *
 * These do not replace the Panel, Metric, Progress, and TableScroll in
 * primitives.tsx yet. Screens move over one at a time in a later stage.
 */
export { Card, CardLink, PriorityCard, StatCard, type StatDirection } from "./card";
export {
  DataTable,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "./data-table";
export { EmptyState, type EmptyStateAction } from "./empty-state";
export { Metric, MetricGroup, type MetricTrend } from "./metric";
export { OperationalList, OperationalListRow, type RowPriority } from "./operational-list";
export { Panel, PanelBody, PanelHeader, SectionHeader } from "./panel";
export { Progress } from "./progress";
export {
  SURFACE_TONES,
  assertNoInteractiveChildren,
  type HeadingLevel,
  type SurfaceTone,
} from "./shared";
