import { describe, it, expect } from 'vitest';
import { SHELL_HTML } from '../../src/dashboard/shell.js';

// The shell is pure data: one self-contained HTML page served at GET / (the
// HTTP behavior is covered by server.test.ts). These tests pin its contract.
describe('SHELL_HTML', () => {
  it('is a complete standalone HTML document', () => {
    expect(SHELL_HTML.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(SHELL_HTML).toContain('<html lang="en">');
    expect(SHELL_HTML).toContain('</html>');
    expect(SHELL_HTML).toContain('<title>webnav dashboard</title>');
  });

  it('has exactly the three operator tabs: Sites + Credentials + Recordings', () => {
    expect(SHELL_HTML).toContain('data-tab="sites"');
    expect(SHELL_HTML).toContain('data-tab="creds"');
    expect(SHELL_HTML).toContain('data-tab="recordings"');
    expect(SHELL_HTML.match(/data-tab="/g)).toHaveLength(3);
  });

  it('drives the dashboard HTTP API endpoints served by server.ts', () => {
    expect(SHELL_HTML).toContain("'/api/sites'");
    expect(SHELL_HTML).toContain("'/api/sites/'");
    expect(SHELL_HTML).toContain("'/api/creds'");
    expect(SHELL_HTML).toContain("'/api/creds/'");
  });

  it('ships the three credential categories the server validates against', () => {
    for (const key of ['login', 'personal', 'other']) {
      expect(SHELL_HTML).toContain(`key: '${key}'`);
    }
  });

  it('defines and uses an HTML-escaping helper for server-supplied strings', () => {
    expect(SHELL_HTML).toContain('function esc(');
    expect(SHELL_HTML).toMatch(/esc\(s\.id\)/);     // site ids escaped before injection
    expect(SHELL_HTML).toMatch(/esc\(site\)/);      // cred site names escaped too
  });

  it('contains no unresolved template interpolation (script built by concatenation)', () => {
    // SHELL_HTML is itself a TS template literal; a nested `${` in the inline
    // script would have been interpolated at module load — assert none leaked.
    expect(SHELL_HTML).not.toContain('${');
  });

  it('masks credential values by default and only reveals on demand', () => {
    expect(SHELL_HTML).toContain('••••••');
    expect(SHELL_HTML).toContain('Reveal');
  });

  it('has a Recordings tab wired to the recordings API', () => {
    expect(SHELL_HTML).toContain('data-tab="recordings"');
    expect(SHELL_HTML).toContain('/api/recordings');
    expect(SHELL_HTML).toContain('/api/replay/status');
    expect(SHELL_HTML).toContain('renderRecordings');
  });
});

it('recordings UX: card on top with optional url, per-row delete, recording pulse', () => {
  expect(SHELL_HTML).toContain('about:blank');                       // url optional → blank window
  expect(SHELL_HTML).toContain('session name required');             // only the session is mandatory
  expect(SHELL_HTML).toContain('✕');                     // per-row delete button
  expect(SHELL_HTML).toContain('recording…');            // live recording indicator
  expect(SHELL_HTML).toContain('webnavpulse');                       // pulse animation defined
  // the New-recording card renders BEFORE the session rows (top of the list)
  expect(SHELL_HTML.indexOf('list.append(newRecordingCard())')).toBeLessThan(SHELL_HTML.indexOf('recs.forEach'));
});

it('detail offers session videos as capture ground-truth', () => {
  expect(SHELL_HTML).toContain('/videos');
  expect(SHELL_HTML).toContain('recordings-media');
  expect(SHELL_HTML).toContain('<video controls');
});

it('Sessions tab: renamed label, bulk delete, default session name', () => {
  expect(SHELL_HTML).toContain('>Sessions</button>');
  expect(SHELL_HTML).toContain('Delete selected');
  expect(SHELL_HTML).toContain("sessIn.value = 'session-'");
});
