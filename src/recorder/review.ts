// Session review: audit what the recorder CAPTURED against what the video SHOWS.
// Pipeline: ffmpeg scene-detection extracts a compact FRAME STRIP from each video
// take (Claude cannot ingest video — stills at change-moments are the consumable
// form, and better for gap-finding since each frame carries a timestamp to match
// against step times) → a headless `claude -p` (Sonnet, per user decision; this is
// a judgment task OUTSIDE webnav's zero-LLM runtime — it audits the tool, it is
// not part of navigation) reads steps+logs+frames and reports capture gaps.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const run = promisify(execFile);

export interface ReviewStepInfo { seq: number; kind: string; label: string; value?: string; capturedAt: number }
export interface ReviewFrame { path: string; atMs: number }

/** Parse ffmpeg showinfo stderr → the pts seconds of each selected frame (in order). */
export function parseShowinfoTimes(stderr: string): number[] {
  const out: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([\d.]+)/g)) out.push(Number(m[1]));
  return out;
}

/** The audit task — shown to the operator in the dashboard and editable per run.
 *  This is the GOAL: compare the video (frames) against the captured steps and
 *  surface CAPTURE GAPS — visible changes with no recorded step. */
export const DEFAULT_INSTRUCTIONS = `Your job — compare what the video SHOWS against what was CAPTURED:
1. For each frame, say what user action most likely produced that screen state.
2. CAPTURE GAPS: visible changes in the frames with NO captured step near that
   timestamp (±5s). These are recorder misses — the deliverable. Be specific:
   what happened on screen, when, and what kind of event the recorder should
   have caught (click / input / navigation / scroll / hover-menu ...).
3. Steps with no visual correlate in any frame (possible over-capture or noise).
4. A short verdict: is this recording complete enough to replay the user's
   journey? What single capture improvement would help most?

Format as markdown with sections: Frames, Capture gaps, Uncorrelated steps, Verdict.
Be concrete and terse. If the evidence is thin (few frames/steps), say so honestly.`;

export interface CaptureGap { atMs?: number; kind?: string; whatHappened?: string; shouldHaveCaptured?: string }

/** Append the structured-output instruction: return a JSON gap list the capture
 *  loop can parse to judge convergence (zero gaps = complete). */
const STRUCTURED_TAIL = `

OUTPUT FORMAT (STRICT): after any brief reasoning, end your reply with ONE JSON
object on its own, exactly:
{"gaps":[{"atMs":<frame time ms>,"kind":"click|input|navigation|scroll|hover-menu|other","whatHappened":"...","shouldHaveCaptured":"..."}],"verdict":"..."}
A gap = a visible change in the frames with NO captured step within ±5s. If capture
is complete, return {"gaps":[],"verdict":"complete"}. Emit NOTHING after the JSON.`;

/** Tolerant extraction of the gap JSON from a review reply (may be wrapped in
 *  prose/markdown). Returns [] on absence/parse failure (never throws). */
export function parseGaps(text: string): CaptureGap[] {
  // last {...} block that parses and has a `gaps` array wins (the model ends with it)
  const matches = text.match(/\{[\s\S]*\}/g);
  if (!matches) return [];
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      const o = JSON.parse(matches[i]) as { gaps?: unknown };
      if (Array.isArray(o.gaps)) return o.gaps as CaptureGap[];
    } catch { /* try the next candidate */ }
  }
  return [];
}

/** The audit prompt. Pure — unit-tested; the spawn stays thin. */
export function buildReviewPrompt(
  session: string,
  steps: ReviewStepInfo[],
  logLines: { t: number; line: string }[],
  frames: ReviewFrame[],
  instructions?: string,
  structured?: boolean,
): string {
  const t = (ms: number) => new Date(ms).toLocaleTimeString();
  const stepTxt = steps.length
    ? steps.map((s) => `- [${t(s.capturedAt)}] seq ${s.seq} ${s.kind}: ${s.label}${s.value !== undefined ? ` = "${s.value}"` : ''}`).join('\n')
    : '(no steps captured)';
  const logTxt = logLines.map((l) => `- [${t(l.t)}] ${l.line}`).join('\n') || '(no logs)';
  const frameTxt = frames.map((f, i) => `- frame ${i + 1} at ${t(f.atMs)}: ${f.path}`).join('\n') || '(no frames extracted)';
  return `You are auditing a browser-session RECORDER for capture gaps. A human browsed a website
while our tool recorded their actions as "steps". We also have a screen video of the same
session, from which scene-change frames were extracted (one image per visible change,
each with its wall-clock timestamp).

Session: ${session}

CAPTURED STEPS (what our recorder saved):
${stepTxt}

RECORDER LOGS (including honest skips):
${logTxt}

VIDEO FRAMES (visible changes; READ each image file with the Read tool):
${frameTxt}

${instructions ?? DEFAULT_INSTRUCTIONS}${structured ? STRUCTURED_TAIL : ''}`;
}

export interface ReviewDeps {
  videosDir: string;                 // ~/.webnav/recordings/<session> (the takes)
  outDir: string;                    // where frames + review.md land
  steps: ReviewStepInfo[];
  logs: { t: number; line: string }[];
  log: (line: string) => void;
  claudeModel?: string;              // default sonnet (user decision for reviews)
  instructions?: string;             // editable audit task (default DEFAULT_INSTRUCTIONS)
  maxFrames?: number;
  structured?: boolean;              // also emit a parseable gap list (for the capture loop)
  exec?: typeof run;                 // injected for tests
}

/** Extract scene-change frames from one take. Returns frames with ABSOLUTE wall-clock
 *  times. The ts in take-<ts>.webm is the STOP/SAVE time (Date.now() at videoStop),
 *  NOT the start — so the true start is reconstructed as stop − ffprobe duration,
 *  and each frame's time is that true start + its pts offset. */
/** The frame-selection expression. Web-UI tuned (live finding: a 10-min browsing
 *  take yielded 4 frames at scene>0.08 — movie-cut thresholds miss typing/menus/
 *  scroll): >2% change counts, a min-gap rate-limits bursts (a playing video would
 *  otherwise eat the whole frame budget in seconds), and a HEARTBEAT guarantees
 *  one frame per interval across the entire timeline even when nothing trips the
 *  threshold — full coverage for the gap audit. Pure: unit-tested. */
export function frameSelectExpr(durationS: number, maxFrames: number): { expr: string; minGapS: number; heartbeatS: number } {
  // budget ~25% of frames for scene-changes so bursts can't cut off tail coverage
  const heartbeatS = Math.max(5, Math.ceil(durationS / Math.max(1, Math.floor(maxFrames * 0.75))));
  const minGapS = Math.max(2, Math.floor(heartbeatS / 3));
  const expr = `isnan(prev_selected_t)+(gt(scene\,0.02)+gte(t-prev_selected_t\,${heartbeatS}))*gte(t-prev_selected_t\,${minGapS})`;
  return { expr, minGapS, heartbeatS };
}

export async function extractFrames(
  takePath: string, takeStopMs: number, framesDir: string, maxFrames: number, exec: typeof run,
): Promise<ReviewFrame[]> {
  mkdirSync(framesDir, { recursive: true });
  let durationS = 0;
  try {
    const pr = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', takePath]);
    durationS = Number(String(pr.stdout).trim()) || 0;
  } catch { /* unknown duration → trueStartMs falls back to takeStopMs (uncorrected, no worse than before) */ }
  const trueStartMs = takeStopMs - Math.round(durationS * 1000);
  const { expr } = frameSelectExpr(durationS, maxFrames);
  const vf = `select='${expr}',showinfo,scale=800:-2`;
  let stderr = '';
  try {
    const r = await exec('ffmpeg', ['-y', '-i', takePath, '-vf', vf, '-fps_mode', 'vfr',
      '-frames:v', String(maxFrames), join(framesDir, 'f-%03d.png')], { maxBuffer: 32 * 1024 * 1024 });
    stderr = r.stderr ?? '';
  } catch (e) {
    // ffmpeg exits non-zero on some streams even after writing frames — keep what landed
    stderr = (e as { stderr?: string }).stderr ?? '';
  }
  const times = parseShowinfoTimes(stderr);
  const files = readdirSync(framesDir).filter((f) => f.endsWith('.png')).sort();
  return files.map((f, i) => ({ path: join(framesDir, f), atMs: trueStartMs + Math.round((times[i] ?? 0) * 1000) }));
}

export async function runSessionReview(session: string, deps: ReviewDeps): Promise<string | { report: string; gaps: CaptureGap[] }> {
  const exec = deps.exec ?? run;
  const maxFrames = deps.maxFrames ?? 20;
  deps.log(`review: extracting frames for ${session}…`);
  let takes: string[] = [];
  try { takes = readdirSync(deps.videosDir).filter((f) => f.endsWith('.webm')).sort(); } catch { /* no videos */ }
  const frames: ReviewFrame[] = [];
  for (const take of takes) {
    const stopMs = Number((/take-(\d+)\.webm/.exec(take) ?? [])[1] ?? 0);
    const dir = join(deps.outDir, 'frames-' + take.replace(/\.webm$/, ''));
    const got = await extractFrames(join(deps.videosDir, take), stopMs, dir, maxFrames, exec);
    frames.push(...got);
    deps.log(`review: ${got.length} change-frames from ${take}`);
  }
  const prompt = buildReviewPrompt(session, deps.steps, deps.logs, frames, deps.instructions, deps.structured);
  deps.log(`review: asking Claude (${deps.claudeModel ?? 'sonnet'}) — ${frames.length} frames, ${deps.steps.length} steps…`);
  let report: string;
  try {
    const { stdout } = await exec('claude',
      ['-p', prompt, '--model', deps.claudeModel ?? 'sonnet', '--allowedTools', 'Read'],
      { maxBuffer: 32 * 1024 * 1024, timeout: 5 * 60_000 });
    report = stdout.trim() || '(claude returned no output)';
  } catch (e) {
    report = 'REVIEW FAILED: ' + String((e as Error).message ?? e);
  }
  mkdirSync(deps.outDir, { recursive: true });
  writeFileSync(join(deps.outDir, 'review.md'), report);
  deps.log('review: done — report saved');
  if (deps.structured) {
    const gaps = parseGaps(report);
    writeFileSync(join(deps.outDir, 'review.json'), JSON.stringify({ gaps }, null, 2));
    return { report, gaps };
  }
  return report;
}
