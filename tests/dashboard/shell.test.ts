import { describe, it, expect } from 'vitest';
import { SHELL_HTML } from '../../src/dashboard/shell.js';

// The shell is pure data: one self-contained HTML page served at GET / (the
// HTTP behavior is covered by server.test.ts). These tests pin its contract.
describe('SHELL_HTML', () => {
  it('is a complete standalone HTML document', () => {
    expect(SHELL_HTML.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(SHELL_HTML).toContain('<html lang="en">');
    expect(SHELL_HTML).toContain('</html>');
    expect(SHELL_HTML).toContain('<title>webnav</title>');
  expect(SHELL_HTML).toContain('class="brand"');       // logo mark + wordmark
  expect(SHELL_HTML).toContain('rel="icon"');           // favicon (inline data-URI)
  });

  it('light/dark theming: both token sets, pre-paint bootstrap, and a toggle', () => {
    expect(SHELL_HTML).toContain(':root[data-theme="light"]');   // light companion ramp
    expect(SHELL_HTML).toContain("data-theme");                   // set on <html>
    expect(SHELL_HTML).toContain("localStorage.getItem('webnav-theme')"); // persisted choice
    expect(SHELL_HTML).toContain('id="themebtn"');                // the toggle button
    expect(SHELL_HTML).toContain('--bg-sunken');                  // tokenized input/code bg (was #0b0d11)
    // no stray hardcoded theme-color literals leaked outside the two :root token blocks
    const body = SHELL_HTML.slice(SHELL_HTML.indexOf('* { box-sizing'));
    expect(body).not.toContain('#0b0d11');   // → var(--bg-sunken)
    expect(body).not.toContain('#8b93a3');   // → var(--muted)
  });

  it('review badge shows all THREE states: verified / failed / unverified', () => {
    expect(SHELL_HTML).toContain('✓ Verified');       // approved (green)
    expect(SHELL_HTML).toContain('⚠ Failed');          // reviewed-but-not-approved (red)
    expect(SHELL_HTML).toContain('Unverified');        // never reviewed (grey)
    expect(SHELL_HTML).toContain('.badge.fail');       // the red style exists
  });

  it('left-pane nav (sidebar), not a top tab bar', () => {
    expect(SHELL_HTML).toContain('class="shell"');     // flex shell wrapping nav + main
    expect(SHELL_HTML).toContain('.shell > nav');      // sidebar styles scoped to direct child
    expect(SHELL_HTML).toContain('.detail nav');       // detail sub-tabs keep their own horizontal style
  });

  it('review is verdict-first with a collapsible full report', () => {
    expect(SHELL_HTML).toContain('class="verdict');    // outcome banner
    expect(SHELL_HTML).toContain('Full review report'); // prose behind an expander
    expect(SHELL_HTML).toContain('excluded from graph building'); // failed-verdict copy
  });

  it('has the operator tabs: Sessions + Sites + Credentials + Profiles', () => {
    expect(SHELL_HTML).toContain('data-tab="recordings"');   // labelled "Sessions"
    expect(SHELL_HTML).toContain('data-tab="sites"');
    expect(SHELL_HTML).toContain('data-tab="creds"');
    expect(SHELL_HTML).toContain('data-tab="profiles"');
    expect(SHELL_HTML.match(/data-tab="/g)).toHaveLength(4);
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

it('Sessions tab: renamed label, bulk delete (in toolbar), new-session dialog, default session name', () => {
  expect(SHELL_HTML).toContain('>Sessions</button>');
  expect(SHELL_HTML).toContain('Delete selected');
  expect(SHELL_HTML).toContain('openNewSessionDialog');              // + New session opens a modal
  expect(SHELL_HTML).toContain('dialog id="newdlg"');                 // the native <dialog> modal
  expect(SHELL_HTML).toContain("const defName = 's-'");              // SHORT: macOS ~104-char socket-path cap
});


it('review UX: md renderer, sub-tab order Steps>Videos>Review>Logs, model+instructions controls', () => {
  expect(SHELL_HTML).toContain('function mdToHtml');
  const order = ['data-sub="steps"', 'data-sub="videos"', 'data-sub="review"', 'data-sub="logs"']
    .map((k) => SHELL_HTML.indexOf(k));
  expect([...order].sort((a, b) => a - b)).toEqual(order);   // declared in that order
  expect(SHELL_HTML).toContain('last run:');
  expect(SHELL_HTML).toContain('review running');
  expect(SHELL_HTML).toContain('<option value="opus">');
  expect(SHELL_HTML).toContain('Agent instructions');
});

it('Sessions list offers Clear all with a typed confirm', () => {
  expect(SHELL_HTML).toContain('Clear all');
  expect(SHELL_HTML).toContain('delete all');   // typed confirmation guard
});

it('Profiles tab: named profiles with new/rename/open/delete', () => {
  expect(SHELL_HTML).toContain('data-tab="profiles"');
  expect(SHELL_HTML).toContain('function renderProfiles');
  expect(SHELL_HTML).toContain('+ New profile');
  expect(SHELL_HTML).toContain('Open to log in');
  expect(SHELL_HTML).toContain('/rename');
});

it('Profiles tab: status chips (Valid/Needs login/Unknown) + Check button', () => {
  expect(SHELL_HTML).toContain('function statusChip');
  expect(SHELL_HTML).toContain('Valid');
  expect(SHELL_HTML).toContain('Needs login');
  expect(SHELL_HTML).toContain('no site associated');
  expect(SHELL_HTML).toContain('>Check<');
  expect(SHELL_HTML).toContain('/status');
});

it('Profiles tab: "Open to log in" disabled when a window is open OR auth is already valid', () => {
  const fn = SHELL_HTML.slice(SHELL_HTML.indexOf('profs.forEach(pf =>'), SHELL_HTML.indexOf('renB.onclick'));
  expect(fn).toContain("const authValid = pf.status && pf.status.auth === 'valid'");
  expect(fn).toContain('openB.disabled = pf.open || !!authValid');
});

it('Profiles tab: login windows are NOT styled as recording (no --rec color, no pulse)', () => {
  const renderProfiles = SHELL_HTML.slice(SHELL_HTML.indexOf('async function renderProfiles'), SHELL_HTML.indexOf('function timeAgo'));
  expect(renderProfiles).not.toContain('var(--rec)');
  expect(renderProfiles).not.toContain('class="pulse"');
  expect(renderProfiles).toContain('window open');
});

it('Profiles tab: Reset profile with a typed "reset <name>" confirm (logout)', () => {
  expect(SHELL_HTML).toContain('Reset profile');
  expect(SHELL_HTML).toContain("'reset '+pf.name");
  expect(SHELL_HTML).toContain('logs out ALL sites in it');
  expect(SHELL_HTML).toContain('/reset');
});
it('new session defaults to the "default" profile; reopen forwards it', () => {
  expect(SHELL_HTML).toContain("profIn.value = 'default'");
  expect(SHELL_HTML).toContain("profile: r.profile || 'default'");   // reopen reuses the session's profile
});

it('reopening a session is persistent (reuses saved login) — not a throwaway profile', () => {
  // the Sessions-tab reopen must send persistent:true (live bug: sent false → forced re-login)
  const reopen = SHELL_HTML.slice(SHELL_HTML.indexOf('const openB = btn('));
  const call = reopen.slice(0, reopen.indexOf('if (!res.ok)'));
  expect(call).toContain('armedOnly: true');
  expect(call).toContain('persistent: true');
  expect(call).not.toContain('persistent: false');
});



it('loadSteps is DEFINED (live #1: it was called but never defined → SSE refresh threw)', () => {
  expect(SHELL_HTML).toMatch(/async function loadSteps\(/);
  // and it is what the live-refresh + tab-switch call
  expect(SHELL_HTML).toContain("if (detailCtx.subTab === 'steps') loadSteps(detailCtx)");
});
it('Open button disabled when a window is live; Record needs a window (#2/#3)', () => {
  expect(SHELL_HTML).toContain('openB.disabled = !!winSession');
  expect(SHELL_HTML).toContain('recB.disabled = !hasWindow && !r.active');
});

it('sessions carry an Agent/Manual origin tag', () => {
  expect(SHELL_HTML).toContain('function originTag');
  expect(SHELL_HTML).toContain('Agent');
  expect(SHELL_HTML).toContain('Manual');
});

it('Sites view renders the shell once and badges provisional states', () => {
  expect(SHELL_HTML).toContain('Site shell');
  expect(SHELL_HTML).toContain('Seen once');
  expect(SHELL_HTML).toContain("=== '_shell'");   // the skip guard in graphView
});
it('key-actions +N more is a real toggle, not a dead chip', () => {
  expect(SHELL_HTML).toContain('morebtn');
  expect(SHELL_HTML).not.toMatch(/\+\d+ more<\/span>/);
});
