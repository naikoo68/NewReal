import { practiceService } from "../services";

// Poll an accept-share background job until it finishes.
//  - onProgress(p) is called on each tick with the latest { status, itemsSaved,
//    itemsTotal, questionsSaved, questionsTotal }.
//  - isAlive() lets the caller stop polling after unmount (returns null then).
// Resolves with the final progress on "done"; throws on "error".
export async function runAcceptShareJob(jobId, onProgress, isAlive = () => true, intervalMs = 700) {
  for (;;) {
    if (!isAlive()) return null;
    const p = await practiceService.acceptShareJob(jobId);
    if (!isAlive()) return null;
    onProgress?.(p);
    if (p.status === "done") return p;
    if (p.status === "error") throw new Error(p.error || "Could not save the shared content.");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Percentage complete for a progress object — prefers questions (the bulk of the
// work); falls back to items when a share has no questions yet.
export function acceptSharePercent(p) {
  if (!p) return 0;
  if (p.questionsTotal > 0) return Math.round((p.questionsSaved / p.questionsTotal) * 100);
  if (p.itemsTotal > 0) return Math.round((p.itemsSaved / p.itemsTotal) * 100);
  return 0;
}
