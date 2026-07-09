// The self-improving capture loop (Step 1 of the agent-recording roadmap).
// Pure orchestrator: each round an agent EXPLORES the same objective (fresh pass),
// then a structured REVIEW audits video-vs-steps for capture gaps. Converges when a
// round returns zero gaps; otherwise PAUSES with the gaps so recorder-code fixes can
// be applied between rounds (the recorder is deterministic code — the loop finds
// gaps, humans/Claude fix them; it does not rewrite the capture engine itself).
// Deps injected so it's unit-tested with fakes — no browser, no LLM.
import type { CaptureGap } from './review.js';

export interface CaptureLoopDeps {
  objective: string;
  maxRounds?: number;                              // default 5
  // drive ONE agent exploration round → returns the recorded sessionId (or null on failure)
  explore: (round: number) => Promise<string | null>;
  // structured audit of a session → its capture gaps
  review: (sessionId: string) => Promise<CaptureGap[]>;
  log: (line: string) => void;
}

export interface CaptureRound { round: number; session: string | null; gaps: CaptureGap[] }
export interface CaptureLoopResult {
  status: 'clean' | 'needs-fix' | 'max-rounds';
  rounds: CaptureRound[];
  gaps: CaptureGap[];                              // gaps from the FINAL round (the actionable set)
}

/** Signature of a gap for thrash-detection: a NEW gap type is one not seen before. */
function gapKind(g: CaptureGap): string { return (g.kind ?? 'other') + ':' + (g.shouldHaveCaptured ?? g.whatHappened ?? ''); }

export async function runCaptureLoop(deps: CaptureLoopDeps): Promise<CaptureLoopResult> {
  const maxRounds = deps.maxRounds ?? 5;
  const rounds: CaptureRound[] = [];
  const seenKinds = new Set<string>();
  let noNewGapStreak = 0;

  for (let round = 1; round <= maxRounds; round++) {
    deps.log(`capture-loop round ${round}/${maxRounds}: exploring "${deps.objective}"…`);
    const session = await deps.explore(round);
    if (!session) {
      deps.log(`round ${round}: exploration failed (no session) — stopping`);
      rounds.push({ round, session: null, gaps: [] });
      return { status: 'needs-fix', rounds, gaps: [] };
    }
    const gaps = await deps.review(session);
    rounds.push({ round, session, gaps });
    deps.log(`round ${round}: ${gaps.length} capture gap(s)`);

    if (gaps.length === 0) {
      deps.log(`round ${round}: CLEAN — capture is complete for this objective`);
      return { status: 'clean', rounds, gaps: [] };
    }

    // thrash guard: if a whole round surfaced no NEW gap TYPE, we're not converging
    // via re-exploration alone → the gaps need code fixes; stop and hand them over.
    const fresh = gaps.filter((g) => !seenKinds.has(gapKind(g)));
    fresh.forEach((g) => seenKinds.add(gapKind(g)));
    if (fresh.length === 0) {
      if (++noNewGapStreak >= 2) {
        deps.log(`round ${round}: no new gap types in 2 rounds — needs code fixes`);
        return { status: 'needs-fix', rounds, gaps };
      }
    } else {
      noNewGapStreak = 0;
    }
    deps.log(`round ${round}: gaps remain → (fix recorder code, then next round)`);
  }

  deps.log(`capture-loop: hit max rounds (${maxRounds}) with gaps remaining`);
  return { status: 'max-rounds', rounds, gaps: rounds[rounds.length - 1]?.gaps ?? [] };
}
