// @vitest-environment jsdom
/// <reference lib="dom" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE WARD CONSOLE'S DESIGN PASS, AND WHAT IT MUST NOT CHANGE (the design-pass kickoff, D2;
 * R-2026-09-26-132 DH-3).
 *
 * The design guards shared with the other apps (viewport, tokens, self-hosted fonts, no
 * inline style, no Google font host) are tests/compliance/bundle_guards.test.ts's. This file
 * holds what is the console's own:
 *
 *   THE STEPPERS -- the one new behaviour in the sprint (the kickoff's qa-specialist input).
 *     − (U+2212) and + change the count field by one, clamped 0 to 500, and NEVER publish:
 *     each is a type="button", so a tap cannot submit the form. Asserted on the pure rule
 *     (stepCount) and on the rendered form, where a tap is watched for any call to
 *     publish_ward_status.
 *   ONE REQUEST PER PUBLISH -- a double tap on Publish still sends one request, as before
 *     D2: the button is disabled for the whole request.
 *   THE WORDS ARE UNCHANGED -- every wardMessageFor sentence, rendered, is byte-identical to
 *     the table's, and renders as a Notice; each ward's summary is summaryLine(...)
 *     exactly; the prototype's "within 30 seconds" is nowhere in the console's source or
 *     its built bundle (BC-7).
 *   THE SIZES -- the count field and its steppers 64 px, Publish and the sign-in button
 *     52 px, the sign-in field 44 px, the count's type 28 px mono. Read as LITERAL px from
 *     apps/ward-console/src/style.css, because a var() cannot be compared here; a rule
 *     that declares none reads null, and null fails.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - what a real browser PAINTS at these sizes. jsdom lays nothing out. The screenshots
 *     (.design-screens/D2/, for Cowork) and the founder's check on a phone after the
 *     deploy are that reading.
 *   - that no OTHER word changed. The sentences a server answer can produce are asserted
 *     here, and the existing exact-text legs in tests/compliance/ward_console_render.test.ts
 *     pass unchanged; the diff of apps/ward-console/src/main.ts is the rest of the proof,
 *     and it is the reviewer's read.
 */

const SRC = join(REPO_ROOT, 'apps', 'ward-console', 'src');
const DIST = join(REPO_ROOT, 'apps', 'ward-console', 'dist');

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sessionFragment(): string {
  const now = Math.floor(Date.now() / 1000);
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    sub: '11111111-1111-4111-8111-111111111111',
    session_id: '22222222-2222-4222-8222-222222222222',
    exp: now + 3600,
    iat: now,
    role: 'authenticated',
    email: 'ward@example.invalid',
  })}.sig`;
  return `#access_token=${token}&refresh_token=r1&expires_at=${now + 3600}&token_type=bearer`;
}

const GOOD_ROW = { category: 'MATERNITY', offering: 'OFFERED', bed_count: 3, accepting: true, version: 4, gated_by: null, monitoring_state: 'ACTIVE', state: 'OK', source: 'WARD' };

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function renderAt(fragment: string, route: Route) {
  document.body.innerHTML = '<main id="app"></main>';
  window.history.replaceState(null, '', `/${fragment}`);
  const stub = vi.fn(async (url: string | URL, init?: RequestInit) => route(String(url), init));
  vi.stubGlobal('fetch', stub);
  const { render } = await import('../../apps/ward-console/src/main.js');
  await render();
  return stub;
}

async function until(cond: () => boolean, deadlineMs = 5000): Promise<void> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('the page never reached the expected state');
}

const publishCalls = (stub: { mock: { calls: unknown[][] } }): number =>
  stub.mock.calls.filter(([u]) => String(u).endsWith('/rest/v1/rpc/publish_ward_status')).length;

const PUBLISHED = [{ version: 5, replayed: false, claim_offering: 'OFFERED', claim_bed_count: 3, claim_accepting: true, public_gated_by: null }];

/** A console showing one ward, whose publish answers `publish` (default: success). */
async function oneWard(row: Record<string, unknown> = GOOD_ROW, publish: Route = () => json(200, PUBLISHED)) {
  const stub = await renderAt(sessionFragment(), (url, init) => {
    if (url.endsWith('/rest/v1/rpc/my_facility_wards')) return json(200, [row]);
    if (url.endsWith('/rest/v1/rpc/publish_ward_status')) return publish(url, init);
    return json(500, { message: 'unexpected call' });
  });
  await until(() => document.querySelector('form.publish') !== null);
  const form = document.querySelector('form.publish') as HTMLFormElement;
  const [minus, plus] = Array.from(form.querySelectorAll('button.stepper')) as HTMLButtonElement[];
  return {
    stub,
    form,
    minus: minus as HTMLButtonElement,
    plus: plus as HTMLButtonElement,
    count: form.querySelector('input[name="bed_count"]') as HTMLInputElement,
    reason: form.querySelector('select[name="reason"]') as HTMLSelectElement,
    publish: form.querySelector('button[type="submit"]') as HTMLButtonElement,
    status: form.querySelector('p.status') as HTMLParagraphElement,
  };
}

/** Lets every queued handler and promise run, so a publish a tap started would have been sent. */
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('the steppers change the count only, clamped 0 to 500, and never publish', () => {
  test.each<[string, string, 1 | -1, string]>([
    ['+ from an ordinary count', '3', 1, '4'],
    ['− from an ordinary count', '3', -1, '2'],
    ['− at 0 stays at 0', '0', -1, '0'],
    ['+ at 500 stays at 500', '500', 1, '500'],
    ['+ from 499 reaches 500', '499', 1, '500'],
    ['− from 1 reaches 0', '1', -1, '0'],
    ['+ on a blank field steps from 0', '', 1, '1'],
    ['− on a blank field stays at 0', '', -1, '0'],
    ['+ on an unreadable field steps from 0', 'abc', 1, '1'],
    ['− above the range comes back to 500', '900', -1, '500'],
    ['+ below the range comes back to 0', '-4', 1, '0'],
    ['a fraction steps from its whole part', '2.5', 1, '3'],
  ])('stepCount — %s', async (_name, value, delta, want) => {
    const { stepCount } = await import('../../apps/ward-console/src/main.js');
    expect(stepCount(value, delta)).toBe(want);
  });

  test('the steppers are − (U+2212) and +, each a type="button", either side of the count', async () => {
    const { form, minus, plus, count } = await oneWard();
    const row = form.querySelector('.count-row') as HTMLElement;
    expect(Array.from(row.children)).toEqual([minus, count, plus]);
    expect(minus.textContent).toBe('−');
    expect(plus.textContent).toBe('+');
    expect(minus.type, 'a stepper that is a submit button publishes on a tap').toBe('button');
    expect(plus.type, 'a stepper that is a submit button publishes on a tap').toBe('button');
  });

  test('tapped past either end, the field stops at 500 and at 0, and reaching 0 offers the reason choice', async () => {
    const { plus, minus, count, reason } = await oneWard({ ...GOOD_ROW, bed_count: 498 });
    for (let i = 0; i < 5; i += 1) plus.click();
    expect(count.value).toBe('500');
    count.value = '2';
    expect(reason.hidden, 'the reason choice shows for a count of 2').toBe(true);
    for (let i = 0; i < 5; i += 1) minus.click();
    expect(count.value).toBe('0');
    expect(reason.hidden, 'the count reached 0 by stepper and the reason choice did not appear').toBe(false);
    plus.click();
    expect(reason.hidden, 'the count left 0 and the reason choice stayed').toBe(true);
  });

  test('no tap on a stepper ever calls publish_ward_status, at any count', async () => {
    const { stub, plus, minus, status } = await oneWard();
    for (let i = 0; i < 12; i += 1) plus.click();
    for (let i = 0; i < 30; i += 1) minus.click();
    await settle();
    expect(publishCalls(stub), 'a stepper tap sent a publish').toBe(0);
    expect(status.textContent, 'a stepper tap produced a publish outcome').toBe('');
  });

  test('plant — a stepper made a submit button publishes on a tap, and the check above sees it', async () => {
    const { stub, plus } = await oneWard();
    plus.type = 'submit';
    plus.click();
    await until(() => publishCalls(stub) > 0);
    expect(publishCalls(stub), 'the planted submit stepper did not publish: the check cannot fail').toBe(1);
  });
});

describe('a double tap on Publish still sends one request', () => {
  test('two taps in a row send exactly one publish_ward_status, and the button is disabled while it is in flight', async () => {
    let release: (r: Response) => void = () => undefined;
    const { stub, publish, status } = await oneWard(GOOD_ROW, () => new Promise<Response>((r) => { release = r; }));
    publish.click();
    publish.click();
    await until(() => publishCalls(stub) > 0);
    expect(publish.disabled, 'Publish is not disabled while the request is in flight').toBe(true);
    release(json(200, PUBLISHED));
    await until(() => (document.querySelector('p.status')?.textContent ?? '') !== '' || status.textContent !== '');
    await settle();
    expect(publishCalls(stub), 'a double tap sent two publishes').toBe(1);
  });

  test('plant — a button re-enabled between the taps sends two, and the count sees it', async () => {
    let release: (r: Response) => void = () => undefined;
    const { stub, publish } = await oneWard(GOOD_ROW, () => new Promise<Response>((r) => { release = r; }));
    publish.click();
    await until(() => publishCalls(stub) > 0);
    publish.disabled = false;
    publish.click();
    await settle();
    expect(publishCalls(stub), 'the plant did not send a second request: the check cannot fail').toBe(2);
    release(json(200, PUBLISHED));
  });
});

describe('the words are unchanged, and every refusal is a Notice', () => {
  test('every wardMessageFor sentence renders byte-identical, as a Notice, from the publish status', async () => {
    const m = await import('../../apps/ward-console/src/main.js');
    const answers: [string, unknown][] = [
      ...Object.keys(m.WARD_MESSAGES).filter((k) => k !== '23514').map((k): [string, unknown] => [m.WARD_MESSAGES[k] as string, { code: 'P0001', message: `${k} detail` }]),
      [m.WARD_MESSAGES['23514'] as string, { code: '23514', message: 'new row violates check constraint' }],
      [m.UNRECOGNISED, { code: 'P0001', message: 'NOT_A_CODE_ANYONE_RAISES' }],
    ];
    expect(answers.length, 'the message table was not read').toBeGreaterThan(14);
    for (const [want, body] of answers) {
      const { status, publish } = await oneWard(GOOD_ROW, () => json(400, body));
      publish.click();
      await until(() => status.textContent !== '');
      expect(status.textContent, `the sentence for ${JSON.stringify(body)} changed on the page`).toBe(want);
      expect(status.classList.contains('notice'), 'a publish refusal is not a Notice').toBe(true);
    }
  });

  test('a handover-load refusal and a refused row render their sentences exactly, as Notices', async () => {
    const m = await import('../../apps/ward-console/src/main.js');
    await renderAt(sessionFragment(), (url) => (url.endsWith('my_facility_wards') ? json(403, { code: '42501', message: 'NOT_A_MEMBER' }) : json(500, {})));
    await until(() => (document.body.textContent ?? '').includes('Could not load'));
    const p = document.querySelector('#app > p') as HTMLParagraphElement;
    expect(p.textContent).toBe(m.WARD_MESSAGES['NOT_A_MEMBER']);
    expect(p.className).toBe('notice');

    await renderAt(sessionFragment(), (url) => (url.endsWith('my_facility_wards') ? json(200, [{ ...GOOD_ROW, version: 0 }]) : json(500, {})));
    await until(() => document.querySelector('p.refused') !== null);
    const refused = document.querySelector('li > p.refused') as HTMLParagraphElement;
    expect(refused.textContent).toBe(`Maternity: ${m.ROW_REFUSED}`);
    expect(refused.classList.contains('notice'), 'a refused row is not a Notice').toBe(true);
  });

  test('each ward card\'s summary is summaryLine(...) exactly, and the signed-out instruction is lead text, not a Notice', async () => {
    const m = await import('../../apps/ward-console/src/main.js');
    const rows = [
      GOOD_ROW,
      { ...GOOD_ROW, category: 'ICU_ADULT', offering: 'NOT_OFFERED', bed_count: null },
      { ...GOOD_ROW, category: 'SURGICAL', accepting: false, gated_by: 'NO_ANAESTHETIST_ON_DUTY', source: 'ADMIN', state: 'UNDER_REVIEW' },
      { ...GOOD_ROW, category: 'THEATRE', bed_count: null, monitoring_state: 'PENDING' },
    ];
    await renderAt(sessionFragment(), (url) => (url.endsWith('my_facility_wards') ? json(200, rows) : json(500, {})));
    await until(() => document.querySelectorAll('li.ward').length === rows.length);
    const shown = Array.from(document.querySelectorAll('ul.wards > li.ward > p.summary')).map((p) => p.textContent);
    expect(shown).toEqual(rows.map((r) => m.summaryLine(m.wardRowFrom(r) as Parameters<typeof m.summaryLine>[0])));

    await renderAt('', () => json(500, {}));
    const lead = document.querySelector('#app > p') as HTMLParagraphElement;
    expect(lead.className).toBe('lead');
    expect(lead.textContent).toBe('Open the sign-in link sent to this ward’s address on this handset, or ask for a new one below.');
  });
});

/** Every file under a directory, recursively. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

const THIRTY_SECONDS = /within\s+30\s+seconds/i;

/** The files that say "within 30 seconds", the prototype's promise the console never makes (BC-7). */
export function thirtySecondsViolations(files: { path: string; text: string }[]): string[] {
  return files.filter((f) => THIRTY_SECONDS.test(f.text)).map((f) => `${f.path} says "within 30 seconds"`);
}

describe('the prototype\'s "within 30 seconds" is nowhere in the console', () => {
  const corpus = (): { path: string; text: string }[] => {
    if (!existsSync(join(DIST, 'index.html'))) throw new Error('ERROR: apps/ward-console has no built output. Run npm run build first: a scan of no bundle is not a verdict.');
    const built = walk(join(DIST, 'assets')).filter((f) => /\.(js|css)$/.test(f));
    return [...walk(SRC), join(REPO_ROOT, 'apps', 'ward-console', 'index.html'), join(DIST, 'index.html'), ...built].map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  };

  test('real apps/ward-console source and build are accepted', () => {
    const out = thirtySecondsViolations(corpus());
    expect(out, out.join('\n')).toEqual([]);
  });

  test('anti-vacuity — the corpus holds the source and the bundle, and the scan finds a phrase that IS there', () => {
    const files = corpus();
    expect(files.some((f) => f.path.endsWith(join('src', 'main.ts')))).toBe(true);
    expect(files.some((f) => /assets\/index-[^/]+\.js$/.test(f.path)), 'the built bundle is not in the corpus').toBe(true);
    // The known-present control: the sign-in sentence's own time, in the source and the bundle.
    expect(files.filter((f) => /within 5 minutes/.test(f.text)).length).toBeGreaterThanOrEqual(2);
  });

  test.each([
    ['the prototype\'s sentence', 'Your count will appear on the public site within 30 seconds.'],
    ['another case and spacing', 'published — WITHIN  30 Seconds'],
  ])('plant — %s is rejected', (_name, text) => {
    expect(thirtySecondsViolations([{ path: 'main.ts', text }])).toEqual(['main.ts says "within 30 seconds"']);
  });
});

/** The literal px a rule declares for `prop`, or null. The rule is found by its exact selector, comments removed. */
function declared(css: string, selector: string, prop: string): number | null {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`).exec(bare)?.[1] ?? '';
  const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*(\\d+)px`).exec(rule);
  return m === null ? null : Number(m[1]);
}

const SIZES: [string, string, string, number][] = [
  ['the count field\'s height', 'input.count', 'height', 64],
  ['the count\'s type size (--text-count-lg)', 'input.count', 'font-size', 28],
  ['a stepper\'s width', 'button.stepper', 'width', 64],
  ['a stepper\'s height', 'button.stepper', 'height', 64],
  ['the primary button\'s height (Publish, and the sign-in button)', 'button.primary', 'min-height', 52],
  ['the sign-in field\'s height', 'label.field input', 'min-height', 44],
];

/** Why the console's style.css does not give the sizes D2 requires, or []. */
export function sizeViolations(css: string): string[] {
  const out: string[] = [];
  for (const [what, selector, prop, want] of SIZES) {
    const got = declared(css, selector, prop);
    if (got === null) out.push(`${what}: ${selector} declares no literal ${prop} in px`);
    else if (got !== want) out.push(`${what}: ${selector} ${prop} is ${got}px, not ${want}px`);
  }
  const count = /(?:^|\})\s*input\.count\s*\{([^}]*)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1] ?? '';
  if (!/font-family\s*:\s*var\(--font-mono\)/.test(count)) out.push('the count field is not set in the mono face');
  return out;
}

describe('the sizes D2 requires, read as literal px from apps/ward-console/src/style.css', () => {
  const CSS = readFileSync(join(SRC, 'style.css'), 'utf8');

  test('real apps/ward-console/src/style.css is accepted', () => {
    const out = sizeViolations(CSS);
    expect(out, out.join('\n')).toEqual([]);
  });

  test.each<[string, string, string, string]>([
    ['the count field at 44px', 'height: 64px;\n  text-align', 'height: 44px;\n  text-align', 'the count field\'s height: input.count height is 44px, not 64px'],
    ['the count\'s type at 18px', 'font-size: 28px;\n  line-height: 1;', 'font-size: 18px;\n  line-height: 1;', 'input.count font-size is 18px, not 28px'],
    ['a stepper 44px wide', 'width: 64px;\n  height: 64px;', 'width: 44px;\n  height: 64px;', 'button.stepper width is 44px, not 64px'],
    ['a stepper 44px tall', 'width: 64px;\n  height: 64px;', 'width: 64px;\n  height: 44px;', 'button.stepper height is 44px, not 64px'],
    ['Publish at 44px', 'min-height: 52px;', 'min-height: 44px;', 'button.primary min-height is 44px, not 52px'],
    ['the sign-in field at 36px', 'min-height: 44px;\n  padding: 0 var(--space-3);\n  font: var(--text-body-lg);\n  color: var(--text-strong);\n  background: var(--surface-card);', 'min-height: 36px;\n  padding: 0 var(--space-3);\n  font: var(--text-body-lg);\n  color: var(--text-strong);\n  background: var(--surface-card);', 'label.field input min-height is 36px, not 44px'],
    ['the count in the sans face', 'font-family: var(--font-mono);\n  font-weight: 600;\n  font-size: 28px;', 'font-family: var(--font-sans);\n  font-weight: 600;\n  font-size: 28px;', 'the count field is not set in the mono face'],
  ])('plant — %s is rejected', (_name, from, to, message) => {
    const planted = CSS.replace(from, to);
    expect(planted, 'the plant did not change the file').not.toBe(CSS);
    expect(sizeViolations(planted).join('\n')).toContain(message);
  });

  test('anti-vacuity — a size given through var() reads as none, and fails', () => {
    const planted = CSS.replace('min-height: 52px;', 'min-height: var(--hit-primary);');
    expect(planted).not.toBe(CSS);
    expect(sizeViolations(planted).join('\n')).toContain('button.primary declares no literal min-height in px');
    expect(sizeViolations('')).toHaveLength(SIZES.length + 1);
  });
});
