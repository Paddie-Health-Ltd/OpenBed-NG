// @vitest-environment jsdom
/// <reference lib="dom" />
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * NO BULK CONTROL ON THE HANDOVER (R-2026-09-27-144 DT, Bundle 2).
 *
 * THE RULE. Each ward is published on its own, with its own count. There is no "publish
 * all" and no "nothing changed" shortcut, so a stale claim cannot be refreshed in one tap.
 * A facility login with several wards makes one tap per ward, and that is the point: a
 * shortcut that re-sends yesterday's counts would put a fresh age on a claim nobody made.
 *
 * HOW IT IS ASSERTED: A WHITELIST OF WHAT THE HANDOVER MAY HOLD, not a list of banned
 * words. A banned-word list passes a shortcut called "Same as before" or "Carry over", or
 * a checkbox rather than a button. So bulkViolations() reads the rendered page and allows
 * exactly this:
 *   - each ward card (li.ward) holds at most one form, and every form is a card's
 *     form.publish;
 *   - each form's named fields are exactly offering, bed_count, accepting and reason:
 *     one count per form, so a form cannot carry two wards;
 *   - the only controls on the handover are each form's one submit, whose words are
 *     "Publish", and its two steppers, − and +, which are type="button" and never
 *     publish (tests/compliance/ward_console_design.test.ts holds that part).
 * Anything else is a violation, whatever its words.
 *
 * THE CORPUS IS THE REAL CONSOLE, RENDERED: apps/ward-console/src/main.ts, imported under
 * jsdom, for a facility login with three wards (every row publishable, the case a bulk
 * control would be built for) and for a ward login with one own ward and two read-only
 * rows. Every plant mutates that rendered page by one thing.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - that the SERVER has no bulk path. It has none: publish_ward_status takes one
 *     category per call (014, as 026 last wrote it), and that signature is
 *     tests/db/publish_ward_status.test.ts's.
 *   - what a real browser paints. The screenshots in .design-screens/DT-2/ are that read.
 */

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

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
    email: 'facility@example.invalid',
  })}.sig`;
  return `#access_token=${token}&refresh_token=r1&expires_at=${now + 3600}&token_type=bearer`;
}

const ROW = { category: 'MATERNITY', offering: 'OFFERED', bed_count: 3, accepting: true, version: 4, gated_by: null, monitoring_state: 'ACTIVE', state: 'OK', source: 'WARD', can_publish: true };
const REPORTER = [ROW, { ...ROW, category: 'ICU_ADULT', bed_count: 1 }, { ...ROW, category: 'THEATRE', bed_count: 0, accepting: false }];
const WARD_LOGIN = [ROW, { ...ROW, category: 'ICU_ADULT', can_publish: false }, { ...ROW, category: 'THEATRE', can_publish: false }];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function renderAt(rows: unknown[]): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/${sessionFragment()}`);
  const route: Route = (url) => (url.endsWith('/rest/v1/rpc/my_reporting_wards') ? json(200, rows) : json(500, { message: 'unexpected call' }));
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => route(String(url), init)));
  const { render } = await import('../../apps/ward-console/src/main.js');
  await render();
  const end = Date.now() + 5000;
  while (!(document.body.textContent ?? '').includes('Handover')) {
    if (Date.now() > end) throw new Error(`the handover never rendered: ${document.body.textContent ?? ''}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const FIELDS = ['accepting', 'bed_count', 'offering', 'reason'];
const STEPPERS = new Set(['−', '+']);

const describeControl = (el: Element): string =>
  `<${el.tagName.toLowerCase()}${el.getAttribute('type') ? ` type="${el.getAttribute('type')}"` : ''}> "${(el.textContent ?? (el as HTMLInputElement).value ?? '').trim() || (el as HTMLInputElement).value || ''}"`;

/** Everything on the handover that is not one ward's own publish form, or is more than one. */
export function bulkViolations(root: ParentNode): string[] {
  const out: string[] = [];
  const list = root.querySelector('ul.wards');
  if (list === null) return ['no handover list (ul.wards) on the page: a guard over no handover is not a pass'];
  const forms = Array.from(root.querySelectorAll('form'));
  if (forms.filter((f) => f.classList.contains('publish')).length === 0) {
    out.push('no publish form on the page: a guard over a handover with nothing to publish is not a pass');
  }

  for (const form of forms) {
    const card = form.closest('li.ward');
    if (!form.classList.contains('publish') || card === null || card.parentElement !== list) {
      out.push(`a form that is not a ward card's own publish form: ${form.outerHTML.slice(0, 120)}`);
    }
    const names = Array.from(form.querySelectorAll('input, select, textarea'))
      .map((el) => el.getAttribute('name') ?? '(unnamed)')
      .sort();
    if (JSON.stringify(names) !== JSON.stringify(FIELDS)) {
      out.push(`a publish form's fields are ${JSON.stringify(names)}, not exactly ${JSON.stringify(FIELDS)}: a form sends one ward's count and nothing else`);
    }
  }

  for (const card of Array.from(list.querySelectorAll(':scope > li.ward'))) {
    const n = card.querySelectorAll('form').length;
    if (n > 1) out.push(`a ward card holds ${n} forms`);
  }

  // Every control on the page: buttons, submit and button inputs, and anything given a
  // button role. Links are allowed only outside the handover list (none are on it today).
  const controls = Array.from(root.querySelectorAll('button, input[type="submit"], input[type="button"], input[type="reset"], [role="button"], ul.wards a'));
  for (const el of controls) {
    const form = el.closest('form.publish');
    const words = (el.textContent ?? '').trim() || ((el as HTMLInputElement).value ?? '').trim();
    const isSubmit = (el.tagName === 'BUTTON' && ((el as HTMLButtonElement).type === 'submit')) || (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'submit');
    if (form === null) {
      out.push(`a control outside every ward's publish form: ${describeControl(el)}`);
      continue;
    }
    if (isSubmit && words !== 'Publish') out.push(`a submit control that is not "Publish": ${describeControl(el)}`);
    if (!isSubmit && !(el.tagName === 'BUTTON' && (el as HTMLButtonElement).type === 'button' && STEPPERS.has(words))) {
      out.push(`a control other than Publish and the two steppers: ${describeControl(el)}`);
    }
  }
  for (const form of forms) {
    const submits = form.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])').length;
    if (submits !== 1) out.push(`a publish form with ${submits} submit controls, not exactly one`);
  }
  return out;
}

/** The rendered page with `mutate` applied, and proof it changed. */
function planted(mutate: (doc: Document) => void): string[] {
  const before = document.body.innerHTML;
  mutate(document);
  expect(document.body.innerHTML, 'the plant did not change the page').not.toBe(before);
  return bulkViolations(document);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('no bulk control on the handover (DT Bundle 2)', () => {
  test('real console, a facility login with three wards, is accepted — three forms, each its own ward\'s, and no other control', async () => {
    await renderAt(REPORTER);
    const out = bulkViolations(document);
    expect(out, out.join('\n')).toEqual([]);
    expect(document.querySelectorAll('form.publish').length, 'the corpus is not the three-ward page it claims').toBe(3);
  });

  test('real console, a ward login with its own ward and two read-only rows, is accepted', async () => {
    await renderAt(WARD_LOGIN);
    const out = bulkViolations(document);
    expect(out, out.join('\n')).toEqual([]);
    expect(document.querySelectorAll('form.publish').length).toBe(1);
  });

  test('anti-vacuity — a page with no handover, and a handover with no publish form, both fail', async () => {
    document.body.innerHTML = '<div id="app"><h1>Handover</h1></div>';
    expect(bulkViolations(document).join('\n')).toContain('no handover list (ul.wards) on the page');
    document.body.innerHTML = '<div id="app"><ul class="wards"><li class="ward"><p class="summary">Maternity: 3 beds</p></li></ul></div>';
    expect(bulkViolations(document).join('\n')).toContain('no publish form on the page');
  });

  test.each<[string, (doc: Document) => void, string]>([
    [
      'a "Publish all" button under the list',
      (doc) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = 'Publish all';
        doc.querySelector('#app')?.append(b);
      },
      'a control outside every ward\'s publish form: <button type="button"> "Publish all"',
    ],
    [
      'a second submit, "Nothing changed", inside a ward\'s form',
      (doc) => {
        const b = doc.createElement('button');
        b.type = 'submit';
        b.textContent = 'Nothing changed';
        doc.querySelector('form.publish')?.append(b);
      },
      'a submit control that is not "Publish": <button type="submit"> "Nothing changed"',
    ],
    [
      'a shortcut worded to dodge a word list, "Same as before"',
      (doc) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = 'Same as before';
        doc.querySelector('form.publish')?.append(b);
      },
      'a control other than Publish and the two steppers: <button type="button"> "Same as before"',
    ],
    [
      'a "no change since last publish" checkbox inside a form',
      (doc) => {
        const c = doc.createElement('input');
        c.type = 'checkbox';
        c.name = 'unchanged';
        doc.querySelector('form.publish')?.append(c);
      },
      'fields are ["accepting","bed_count","offering","reason","unchanged"]',
    ],
    [
      'one form carrying a second ward\'s count',
      (doc) => {
        const i = doc.createElement('input');
        i.type = 'number';
        i.name = 'bed_count';
        doc.querySelector('form.publish')?.append(i);
      },
      'fields are ["accepting","bed_count","bed_count","offering","reason"]',
    ],
    [
      'a form outside every ward card',
      (doc) => {
        const f = doc.querySelector('form.publish')?.cloneNode(true) as HTMLFormElement;
        doc.querySelector('#app')?.append(f);
      },
      "a form that is not a ward card's own publish form",
    ],
    [
      'a control given a button role on a card',
      (doc) => {
        const d = doc.createElement('div');
        d.setAttribute('role', 'button');
        d.textContent = 'Refresh all';
        doc.querySelector('li.ward')?.append(d);
      },
      'a control outside every ward\'s publish form: <div> "Refresh all"',
    ],
  ])('plant — %s is rejected', async (_name, mutate, message) => {
    await renderAt(REPORTER);
    expect(bulkViolations(document), 'the real page is not clean before the plant').toEqual([]);
    const out = planted(mutate);
    expect(out.join('\n'), `the plant was accepted; the guard said: ${JSON.stringify(out)}`).toContain(message);
  });
});
