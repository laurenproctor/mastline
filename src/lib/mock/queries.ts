/**
 * What remains of the mock layer.
 *
 * Everything else now reads the database through src/lib/data/. Only News Radar
 * still lives here, because there is no opportunity source to read from yet:
 * the first release uses manually entered stories so the archive-matching
 * workflow can be tested before any live feed exists.
 *
 * This module goes away in Phase 4.
 */

import type { Opportunity } from "../domain";
import { OPPORTUNITIES } from "./fixtures";

export async function listOpportunities(): Promise<readonly Opportunity[]> {
  return OPPORTUNITIES;
}
