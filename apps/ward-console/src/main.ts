import { SessionExpiredError, SessionHolder, sessionFromUrlFragment } from '@openbed/auth';

/**
 * THE WARD CONSOLE. One screen: arrive from a magic link, and see the wards
 * this account may report for.
 *
 * WHY THERE IS NO SUPABASE CLIENT HERE. `tests/setup/auth.ts` proved the whole
 * magic-link route with plain `fetch` before any app existed. Had this file
 * reached for @supabase/supabase-js, the system would have had TWO derivation
 * sites for how it authenticates -- one the harness proves and a different one
 * the app ships -- at the auth seam, which is the drift §7 of
 * .claude/rules/test-conventions.md closes everywhere else. So both sides now
 * import packages/auth/src/session.ts, and there is one.
 *
 * THAT IS THE REASON. The bundle guard reddening on the library's JSDoc was
 * NOT: deciding architecture to quiet a guard is the tail wagging the dog, and
 * `scripts/lint_no_service_role_in_bundle.sh` was fixed on its own merits in the
 * same branch, so it would pass supabase-js today.
 *
 * WHAT WAS GIVEN UP, since it is real. The library buys session persistence and
 * background token refresh. Persistence is deliberately not wanted -- the
 * ward-identity decision of 2026-09-08 makes access follow PHYSICAL CONTROL OF
 * THE WARD HANDSET, which is what replaced the offboarding SOP -- and refresh
 * is taken on demand with a single in-flight promise, because one handset and
 * one screen removes the cross-tab race the library's machinery exists for.
 *
 * SCOPE, stated so the emptiness is not read as unfinished work. The handover
 * list is everything this screen can honestly do today: publishing a bed count
 * needs `public.publish_ward_status`, which is migration 014, which is blocked
 * on the founder applying 001-013 to the hosted project. The golden path stops
 * at the same step for the same reason.
 *
 * CLASSIFICATION (Clause 5): the sign-in and handover path is LIVE -- it runs
 * against the local stack and golden-path steps 0-5 pass against it. The
 * publish path does not exist.
 */

const API_URL = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
const PUBLISHABLE_KEY = import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] as string | undefined;

const root = document.querySelector<HTMLDivElement>('#app');

function show(heading: string, detail: string): void {
  if (root === null) return;
  const h = document.createElement('h1');
  h.textContent = heading;
  const p = document.createElement('p');
  p.textContent = detail;
  root.replaceChildren(h, p);
}

function showWards(email: string | null, categories: string[]): void {
  if (root === null) return;
  const h = document.createElement('h1');
  h.textContent = 'Handover';
  const who = document.createElement('p');
  who.textContent = email === null ? 'Signed in.' : `Signed in as ${email}.`;
  const list = document.createElement('ul');
  for (const c of categories) {
    const li = document.createElement('li');
    li.textContent = c;
    list.append(li);
  }
  const note = document.createElement('p');
  note.textContent = 'Publishing a bed count is not available yet.';
  root.replaceChildren(h, who, list, note);
}

/** The one message an expired or unrenewable session produces. There is no other. */
const TAP_AGAIN = 'Your session has ended. Tap the link on the ward handset again to sign back in.';

async function main(): Promise<void> {
  // A MISSING KEY IS A STOP CONDITION, NOT A VALUE TO WORK AROUND. Vite replaces
  // an unset import.meta.env read with `undefined` at build time, so a console
  // built without these would otherwise send `Bearer undefined` and report an
  // auth failure that has nothing to do with auth. `scripts/get_publishable_key.sh`
  // learned the same lesson the hard way with a fallback to a dead key.
  if (API_URL === undefined || PUBLISHABLE_KEY === undefined) {
    show(
      'Not configured',
      'This build has no VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. It was built without them and cannot sign anyone in.',
    );
    return;
  }

  let session;
  try {
    session = sessionFromUrlFragment(window.location.hash);
  } catch (e) {
    // The link itself was refused -- already used, or expired. Saying "not
    // signed in" here would leave the ward tapping a link that will never work.
    show('That link did not work', `${String((e as Error).message)} Ask for a new link to be sent.`);
    return;
  }

  if (session === null) {
    show('Ward console', 'Open the sign-in link sent to this ward’s address on this handset.');
    return;
  }

  // THE TOKENS LEAVE THE ADDRESS BAR IMMEDIATELY. A fragment is never sent to a
  // server, but it is visible on screen, survives a screenshot, and is carried
  // by anything the ward pastes the URL into.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);

  const holder = new SessionHolder({ apiUrl: API_URL, anonKey: PUBLISHABLE_KEY, session });

  try {
    const res = await holder.authedFetch('rpc/my_facility_wards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      // NAME THE STATUS. "Could not load" is compatible with every hypothesis:
      // a missing ward_account row, an unapplied migration and a network blip
      // all look identical without it.
      show('Could not load the handover list', `The server answered ${res.status}. ${await res.text()}`);
      return;
    }
    const rows = (await res.json()) as { category?: string }[];
    showWards(holder.session?.claims.email ?? null, rows.map((r) => r.category ?? '(unnamed ward)'));
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      show('Signed out', TAP_AGAIN);
      return;
    }
    throw e;
  }
}

void main();
