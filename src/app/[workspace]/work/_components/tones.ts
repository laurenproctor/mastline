import type { Tone } from "@/components/badge";
import type { WorkQueueItem } from "@/lib/data/work-queue";

/** The badge tone for each kind of queue item, as the screen has always drawn them. */
export const KIND_TONE: Record<WorkQueueItem["kind"], Tone> = {
  Request: "blue",
  Shoot: "warn",
  Dispatch: "blue",
  Submission: "blue",
  Money: "warn",
};
