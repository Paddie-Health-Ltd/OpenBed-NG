// @vitest-environment jsdom
/// <reference lib="dom" />
// DOM TYPES FOR THIS FILE ONLY (see tests/compliance/dashboard_empty_state.test.ts).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PRIVACY_NOTICE_URL } from '../../packages/origins/src/privacy.js';
import { deployableApps, outputDirOf } from './_apps.js';
import { place, REPO_ROOT, withScratch } from './_scratch.js';

/**
 * EVERY SIGN-IN SCREEN AND THE PUBLIC FOOTER LINK THE ONE PRIVACY NOTICE
 * (R-2026-09-26-136 DL-1 d).
 *
 * "Privacy notice" links to https://openbed.ng/privacy from the openbed.ng footer, the
 * ward console's sign-in screen and the admin sign-in screen. The URL is ONE tracked
 * constant, packages/origins/src/privacy.ts. Four controls, each of which the others
 * cannot stand in for:
 *
 *   1. RENDERED. Each app is rendered in jsdom, in every state that offers a sign-in
 *      (signed out, bad link, link sent) or the footer, and the DOM must hold a real
 *      <a> whose href is the constant and whose text is "Privacy notice". The DOM, not
 *      the source: a link built and never appended passes a source grep.
 *   2. BUILT. Each deployable app's built bundle carries the URL. One plant per app in
 *      a scratch tree, named by identity while every other app stays clean
 *      (tests/compliance/bundle_guards.test.ts's per-app pattern), so the scan is shown
 *      to REACH each app rather than assumed to.
 *   3. ONE CONSTANT. The URL is typed nowhere under apps/ or packages/ except in
 *      privacy.ts. A second copy is how two links drift apart.
 *   4. 44 px. Each app's stylesheet gives the link a 44 px tap target, read as a
 *      literal from the rule that styles it.
 *
 * NOT ASSERTED HERE, deliberately: that https://openbed.ng/privacy answers with the
 * notice -- the deployment's property. scripts/readback_pages.sh reads it (DL-1 e).
 */

const TEXT = 'Privacy notice';

/** Why a rendered surface does not carry the privacy link, or []. */
function linkViolations(root: ParentNode, where: string): string[] {
  const links = Array.from(root.querySelectorAll('a')).filter((a) => a.getAttribute('href') === PRIVACY_NOTICE_URL);
  if (links.length === 0) return [`${where}: no <a href="${PRIVACY_NOTICE_URL}">`];
  if (!links.some((a) => (a.textContent ?? '').trim() === TEXT)) return [`${where}: the privacy link does not read "${TEXT}"`];
  return [];
}

/** Why an app's built bundle does not carry the URL, or [] -- for every app under `root`. */
function bundleViolations(root: string): string[] {
  const out: string[] = [];
  const apps = deployableApps(root);
  if (apps.length === 0) return ['no deployable app found: a link guard over no app is not a pass'];
  for (const app of apps) {
    const assets = join(root, 'apps', app, outputDirOf(app, root), 'assets');
    const js = existsSync(assets) ? readdirSync(assets).filter((f) => f.endsWith('.js')) : [];
    if (js.length === 0) {
      out.push(`apps/${app}: no built JavaScript under ${outputDirOf(app, root)}/assets -- build it first`);
      continue;
    }
    if (!js.some((f) => readFileSync(join(assets, f), 'utf8').includes(PRIVACY_NOTICE_URL))) {
      out.push(`apps/${app}: the built bundle does not carry ${PRIVACY_NOTICE_URL}`);
    }
  }
  return out;
}

const CONSTANT_FILE = 'packages/origins/src/privacy.ts';

/** Every file other than the constant's own that types the URL. */
function literalViolations(files: { path: string; text: string }[]): string[] {
  if (files.length === 0) return ['no file was scanned: the one-constant check read nothing'];
  return files.filter((f) => f.path !== CONSTANT_FILE && f.text.includes(PRIVACY_NOTICE_URL)).map((f) => `${f.path}: types ${PRIVACY_NOTICE_URL}; import PRIVACY_NOTICE_URL from @openbed/origins/privacy`);
}

function trackedUnder(dirs: string[]): { path: string; text: string }[] {
  // Tracked AND untracked-but-not-ignored: a new file carrying the URL is caught before
  // it is ever committed, and dist/ (ignored) is left to the bundle leg above.
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...dirs], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split('\0').filter((p) => p !== '' && existsSync(join(REPO_ROOT, p))).map((p) => ({ path: p, text: readFileSync(join(REPO_ROOT, p), 'utf8') }));
}

/** The rule that styles the privacy link, from a stylesheet, comments removed. */
function tapTargetViolations(css: string, selector: string, where: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim());
    if (selectors.includes(selector) && /(^|;)\s*min-height:\s*44px\s*(;|$)/.test((m[2] ?? '').trim())) return [];
  }
  return [`${where}: no "${selector}" rule with min-height: 44px`];
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function renderApp(app: 'ward-console' | 'admin', fragment: string): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/${fragment}`);
  vi.stubGlobal('fetch', vi.fn(async () => json(200, {})));
  const mod = app === 'ward-console'
    ? await import('../../apps/ward-console/src/main.js')
    : await import('../../apps/admin/src/main.js');
  await mod.render();
}

async function until(cond: () => boolean, deadlineMs = 5000): Promise<void> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('the page did not reach the expected state in time');
}

const BAD_LINK = '#error=access_denied&error_code=otp_expired';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the privacy notice is linked from every sign-in screen and the public footer (R-2026-09-26-136 DL-1 d)', () => {
  test('real — the one constant is the notice\'s URL', () => {
    expect(PRIVACY_NOTICE_URL).toBe('https://openbed.ng/privacy');
  });

  test('real openbed.ng footer is accepted — it carries the privacy link', async () => {
    document.body.innerHTML = '<main id="app"></main><footer id="site-footer"></footer>';
    vi.stubGlobal('fetch', vi.fn(async () => json(500, {})));
    const { renderFooter } = await import('../../apps/public-dashboard/src/main.js');
    renderFooter();
    const footer = document.getElementById('site-footer') as HTMLElement;
    const out = linkViolations(footer, 'the openbed.ng footer');
    expect(out, out.join('\n')).toEqual([]);
  });

  test.each([
    ['ward-console', 'signed out', ''],
    ['ward-console', 'bad link', BAD_LINK],
    ['admin', 'signed out', ''],
    ['admin', 'bad link', BAD_LINK],
  ] as const)('real %s sign-in screen (%s) is accepted — it carries the privacy link', async (app, _state, fragment) => {
    await renderApp(app, fragment);
    const out = linkViolations(document.body, `${app} (${_state})`);
    expect(out, `${out.join('\n')}\n--- page text:\n${document.body.textContent ?? ''}`).toEqual([]);
  });

  test.each(['ward-console', 'admin'] as const)('real %s sign-in screen after a link is sent is accepted — the privacy link stays', async (app) => {
    await renderApp(app, '');
    const form = document.querySelector('form.signin-request') as HTMLFormElement;
    (form.querySelector('input[type="email"]') as HTMLInputElement).value = 'ward@example.test';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => (document.querySelector('form.signin-request p.status')?.textContent ?? '') !== '');
    const out = linkViolations(document.body, `${app} (link sent)`);
    expect(out, `${out.join('\n')}\n--- page text:\n${document.body.textContent ?? ''}`).toEqual([]);
  });

  test.each(['ward-console', 'admin'] as const)('plant — %s with its privacy link pointed elsewhere is rejected', async (app) => {
    await renderApp(app, '');
    const link = Array.from(document.querySelectorAll('a')).find((a) => a.getAttribute('href') === PRIVACY_NOTICE_URL);
    expect(link, 'the real screen has no privacy link to plant against').toBeDefined();
    link?.setAttribute('href', 'https://openbed.ng/elsewhere');
    expect(document.querySelector(`a[href="${PRIVACY_NOTICE_URL}"]`), 'the plant did not land').toBeNull();
    expect(linkViolations(document.body, app).join('\n')).toContain(`${app}: no <a href="${PRIVACY_NOTICE_URL}">`);
  });

  test('plant — a link with other words, or text that is not a link, is rejected', () => {
    const wrongWords = document.createElement('div');
    wrongWords.innerHTML = `<a href="${PRIVACY_NOTICE_URL}">Read more</a>`;
    expect(linkViolations(wrongWords, 'x').join('\n')).toContain('does not read "Privacy notice"');
    const notALink = document.createElement('div');
    notALink.innerHTML = `<span data-href="${PRIVACY_NOTICE_URL}">Privacy notice</span>`;
    expect(linkViolations(notALink, 'x').join('\n')).toContain('no <a href=');
  });

  test('real built bundles are accepted — every deployable app carries the URL', () => {
    const out = bundleViolations(REPO_ROOT);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('anti-vacuity — more than one app is discovered, or the per-app plants below prove nothing', () => {
    expect(deployableApps().length, 'fewer than two apps: the per-app plants are vacuous').toBeGreaterThan(1);
  });

  test.each(deployableApps())('plant — apps/%s built without the link is named, and every OTHER app stays clean', (dirty) => {
    withScratch((root) => {
      for (const app of deployableApps()) {
        place(root, `apps/${app}/wrangler.toml`, readFileSync(join(REPO_ROOT, 'apps', app, 'wrangler.toml'), 'utf8'));
        place(root, `apps/${app}/${outputDirOf(app)}/assets/${app}.js`, app === dirty ? 'export const x = 1;' : `const u = "${PRIVACY_NOTICE_URL}";`);
      }
      const out = bundleViolations(root);
      expect(out, `apps/${dirty} built without the link was not named`).toEqual([`apps/${dirty}: the built bundle does not carry ${PRIVACY_NOTICE_URL}`]);
    });
  });

  test('real — the URL is typed only in packages/origins/src/privacy.ts under apps/ and packages/ (tracked or new)', () => {
    const files = trackedUnder(['apps', 'packages']);
    expect(files.map((f) => f.path), 'the constant\'s own file is not in the corpus').toContain(CONSTANT_FILE);
    const out = literalViolations(files);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('plant — the URL typed into an app is rejected', () => {
    const out = literalViolations([
      { path: CONSTANT_FILE, text: `export const PRIVACY_NOTICE_URL = '${PRIVACY_NOTICE_URL}';` },
      { path: 'apps/admin/src/main.ts', text: `a.href = '${PRIVACY_NOTICE_URL}';` },
    ]);
    expect(out.join('\n')).toContain('apps/admin/src/main.ts: types');
  });

  test.each([
    ['public-dashboard', '#site-footer a'],
    ['ward-console', '.privacy a'],
    ['admin', '.privacy a'],
  ])('real apps/%s stylesheet gives the privacy link a 44 px target', (app, selector) => {
    const css = readFileSync(join(REPO_ROOT, 'apps', app, 'src', 'style.css'), 'utf8');
    const out = tapTargetViolations(css, selector, `apps/${app}/src/style.css`);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('plant — a privacy link rule below 44 px is rejected', () => {
    expect(tapTargetViolations('.privacy a { min-height: 32px; }', '.privacy a', 'x').join('\n')).toContain('min-height: 44px');
    expect(tapTargetViolations('/* .privacy a { min-height: 44px; } */', '.privacy a', 'x').join('\n')).toContain('min-height: 44px');
  });

  test('anti-vacuity — checker over an empty corpus fails', () => {
    expect(literalViolations([])).toEqual(['no file was scanned: the one-constant check read nothing']);
    withScratch((root) => {
      expect(bundleViolations(root)).toEqual(['no deployable app found: a link guard over no app is not a pass']);
    });
    expect(linkViolations(document.createElement('div'), 'empty').join('\n')).toContain('no <a href=');
  });
});
