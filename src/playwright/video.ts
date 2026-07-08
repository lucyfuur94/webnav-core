// Per-recording video capture, shared by BOTH the human live-record loop and the
// agent `use navigate` path. A "take" is one Record→Stop span → one
// ~/.webnav/recordings/<session>/take-<ts>.webm. Idempotent per span (a start
// while already recording, or a stop while already stopped, is a no-op).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface VideoAdapter {
  videoStart(): Promise<void>;
  videoStop(filename: string): Promise<boolean>;
}

export interface VideoSyncDeps {
  videosRoot: string;                 // ~/.webnav/recordings
  log: (line: string) => void;
  onSaved?: () => void;               // e.g. emit('sessions') so the dashboard refreshes
  now?: () => number;                 // injectable clock (tests)
}

/** Make a stateful videoSync(session, recording) bound to one adapter+deps.
 *  Returns the closure the caller invokes on each record-state change. */
export function makeVideoSync(getAdapter: () => VideoAdapter | null, deps: VideoSyncDeps) {
  const now = deps.now ?? (() => Date.now());
  let videoOn = false;
  return (session: string, recording: boolean): void => {
    const adapter = getAdapter();
    if (recording && !videoOn && adapter) {
      videoOn = true;
      void adapter.videoStart().then(
        () => deps.log('video: recording started'),
        () => deps.log('video: START FAILED'));
    } else if (!recording && videoOn && adapter) {
      videoOn = false;
      const dir = join(deps.videosRoot, session);
      try { mkdirSync(dir, { recursive: true }); } catch { /* decoration */ }
      const file = join(dir, 'take-' + now() + '.webm');
      void adapter.videoStop(file).then((ok) => {
        deps.log(ok ? 'video: saved ' + file : 'video: SAVE FAILED (' + file + ')');
        deps.onSaved?.();
      });
    }
  };
}
