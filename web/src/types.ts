// The viewer's contract with the server. Type-only imports via the @server alias
// so the API can't drift silently (tsc fails if these change shape).
export type { GraphView } from '@server/graph/export.js';
export type { NodeInteriorView } from '@server/graph/interior.js';
