import { SessionExpiredError, SessionHolder, sessionFromUrlFragment } from '@openbed/auth';
import { apiOrigin } from '@openbed/origins';
import { publishableKeyFor } from '@openbed/origins/keys';

/**
 * THE WARD CONSOLE. Sign in with a magic link, see the wards at this account's
 * facility, and publish a bed count for one of them.
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
 * WHY A PUBLISH FORM PER ROW, NOT ONE FORM FOR "MY WARD". my_facility_wards()
 * returns every ward category at the account's facility (for handover
 * visibility), not just the one this account may publish for, and nothing in
 * its return columns or in the session's claims identifies which row that is.
 * Rather than guess client-side, every row gets its own inline publish form,
 * sourced entirely from that row's own already-loaded data (category, version)
 * -- never user-typed. The server remains the sole authority on which
 * submission succeeds: publishing from the wrong row surfaces WARD_SCOPE_DENIED
 * exactly like any other rejection. This is the same model the header above
 * already describes -- access follows physical control of the handset, which
 * in practice means only the row for this handset's own ward will ever accept
 * a publish.
 *
 * NOT ASSERTED HERE, deliberately (method note 12): the RENDERED text of the
 * "Not configured" screen. Nothing in this repository renders this console -- the
 * only jsdom test is the public dashboard's -- so its wording is checked by reading
 * and not by a test. Said plainly rather than left for a reader to assume covered;
 * R-2026-09-22-57 F2's ward-side sign-in form arrives in PR 3.2 and is the change
 * that gives this file a rendered surface worth asserting.
 *
 * CLASSIFICATION (Clause 5): the sign-in and handover path is LIVE -- it runs
 * against the local stack and golden-path steps 0-5 pass against it. The
 * publish RPC is LIVE, proved by tests/db/publish_ward_status.test.ts and the
 * golden path's publish steps. THE PUBLISH SCREEN IS NOW LIVE TOO: submitPublish
 * below calls it over holder.authedFetch, the same authenticated-fetch pattern
 * the handover read already used.
 */

/**
 * WHERE THIS CONSOLE'S DATABASE ADDRESS COMES FROM (R-2026-09-22-57 item 1).
 *
 * It was `import.meta.env['VITE_SUPABASE_URL']`, read from an untracked .env.local.
 * That was Finding D exactly: the address this app used in production was a fact
 * that lived on one laptop, and no build, test or reader of this repository could
 * say what it was. It is now TRACKED CONFIGURATION, chosen at RUNTIME from the host
 * the console is being served on -- so a build carries every environment's origin
 * and none of them depends on who ran the build or what they had set.
 *
 * THE KEY IS TRACKED TOO, SINCE R-2026-09-22-61, AND THIS PARAGRAPH USED TO SAY THE
 * OPPOSITE. It argued the key must stay an environment variable because a credential
 * has a lifecycle the repository does not, and that tracking it would make this
 * repository the place a STALE key lives -- a dead key authenticating nothing while
 * every probe reads as though the boundary held. **That objection was answered, not
 * overruled:** `docs/runbook-key-rotation.md` now moves this one tracked line in the
 * same change as a rotation, which is what keeps a tracked key from going stale.
 * What tracking buys is that THE STAMPED COMMIT FULLY DETERMINES THE BUNDLE.
 *
 * SO THIS FILE READS NO ENVIRONMENT AT ALL, and that is the whole point rather than
 * a tidy side effect (R-2026-09-22-60). Vite inlines the WHOLE `import.meta.env`
 * record for a bracket access, so the single read that used to be here dragged every
 * VITE_ name from an untracked .env.local into the shipped bundle -- including one
 * that nothing read any more. With no read at all, Vite's define never fires and the
 * output cannot vary with a file or with a shell.
 */
const API_URL = apiOrigin(window.location.hostname);
const PUBLISHABLE_KEY = publishableKeyFor(window.location.hostname);

const root = document.querySelector<HTMLDivElement>('#app');

function show(heading: string, detail: string): void {
  if (root === null) return;
  const h = document.createElement('h1');
  h.textContent = heading;
  const p = document.createElement('p');
  p.textContent = detail;
  root.replaceChildren(h, p);
}

/** The one message an expired or unrenewable session produces. There is no other. */
const TAP_AGAIN = 'Your session has ended. Tap the link on the ward handset again to sign back in.';

interface WardRow {
  readonly category: string;
  readonly offering: string;
  readonly bedCount: number | null;
  readonly accepting: boolean;
  readonly version: number;
  readonly gatedBy: string | null;
}

function wardRowFrom(r: {
  category?: string;
  offering?: string;
  bed_count?: number | null;
  accepting?: boolean;
  version?: number;
  gated_by?: string | null;
}): WardRow {
  return {
    category: r.category ?? '(unnamed ward)',
    offering: r.offering ?? 'NOT_OFFERED',
    bedCount: r.bed_count ?? null,
    accepting: r.accepting === true,
    version: r.version ?? 0,
    gatedBy: r.gated_by ?? null,
  };
}

interface PublishResult {
  readonly version: number;
  readonly replayed: boolean;
  readonly claim_offering: string;
  readonly claim_bed_count: number | null;
  readonly claim_accepting: boolean;
  readonly public_gated_by: string | null;
}

type PublishOutcome = { readonly ok: true; readonly result: PublishResult } | { readonly ok: false; readonly message: string };

/** A fresh id per NEW publish attempt. Reused verbatim on a retry of the SAME
 * attempt (see publishFormFor) so a retried request replays rather than
 * duplicates; a new one is only minted after a submission succeeds. */
function newMutationId(): string {
  return crypto.randomUUID();
}

async function submitPublish(
  holder: SessionHolder,
  ward: WardRow,
  form: { offering: string; bedCount: number; accepting: boolean; reason: string | null },
  mutationId: string,
): Promise<PublishOutcome> {
  const res = await holder.authedFetch('rpc/publish_ward_status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_category: ward.category,
      p_offering: form.offering,
      p_bed_count: form.bedCount,
      p_accepting: form.accepting,
      p_reason: form.reason,
      p_expected_version: ward.version,
      p_client_mutation_id: mutationId,
      p_composed_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    // NAME THE STATUS, same convention as the handover read below. PostgREST's
    // error body already carries the exact rejection code in its `message`
    // field, so even the generic fallback below never swallows which one fired.
    const text = await res.text();
    if (text.includes('VERSION_CONFLICT')) {
      return { ok: false, message: 'Someone else already updated this ward. Reload the handover list before trying again.' };
    }
    if (text.includes('ZERO_REQUIRES_REASON')) {
      return { ok: false, message: 'Publishing zero beds as OFFERED needs a reason.' };
    }
    return { ok: false, message: `The server answered ${res.status}. ${text}` };
  }

  const rows = (await res.json()) as PublishResult[];
  const result = rows[0];
  if (result === undefined) {
    return { ok: false, message: 'The server accepted the update but returned no row.' };
  }
  return { ok: true, result };
}

function publishFormFor(holder: SessionHolder, ward: WardRow, onUpdated: (updated: WardRow) => void): HTMLFormElement {
  const form = document.createElement('form');

  const offeringSelect = document.createElement('select');
  for (const opt of ['OFFERED', 'NOT_OFFERED']) {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt;
    if (opt === ward.offering) option.selected = true;
    offeringSelect.appendChild(option);
  }

  const bedCountInput = document.createElement('input');
  bedCountInput.type = 'number';
  bedCountInput.min = '0';
  bedCountInput.required = true;
  bedCountInput.value = ward.bedCount === null ? '' : String(ward.bedCount);

  const acceptingInput = document.createElement('input');
  acceptingInput.type = 'checkbox';
  acceptingInput.checked = ward.accepting;
  const acceptingLabel = document.createElement('label');
  acceptingLabel.append(acceptingInput, document.createTextNode('Accepting'));

  // Shown/required only when offering=OFFERED and bed_count=0 -- a client-side
  // pre-check mirroring ZERO_REQUIRES_REASON. The server check still runs
  // regardless; this only saves a round trip on the common case.
  const reasonInput = document.createElement('input');
  reasonInput.type = 'text';
  reasonInput.placeholder = 'Reason (required when publishing zero beds as offered)';
  reasonInput.hidden = true;

  function syncReasonVisibility(): void {
    const needsReason = offeringSelect.value === 'OFFERED' && bedCountInput.value === '0';
    reasonInput.hidden = !needsReason;
    reasonInput.required = needsReason;
  }
  offeringSelect.addEventListener('change', syncReasonVisibility);
  bedCountInput.addEventListener('input', syncReasonVisibility);
  syncReasonVisibility();

  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.textContent = 'Publish';

  const status = document.createElement('p');

  let mutationId = newMutationId();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      submitButton.disabled = true;
      status.textContent = '';

      const bedCount = Number(bedCountInput.value);
      const reason = reasonInput.value.trim() === '' ? null : reasonInput.value.trim();
      const needsReason = offeringSelect.value === 'OFFERED' && bedCount === 0;
      if (needsReason && reason === null) {
        status.textContent = 'Publishing zero beds as OFFERED needs a reason.';
        submitButton.disabled = false;
        return;
      }

      try {
        const outcome = await submitPublish(
          holder,
          ward,
          { offering: offeringSelect.value, bedCount, accepting: acceptingInput.checked, reason },
          mutationId,
        );
        if (!outcome.ok) {
          status.textContent = outcome.message;
          return;
        }
        // A fresh attempt gets a new mutation id; a retry of THIS attempt
        // would have reused `mutationId` above, never regenerating it on a
        // failure branch.
        mutationId = newMutationId();
        status.textContent = outcome.result.replayed ? 'Already published (replay).' : 'Published.';
        onUpdated({
          category: ward.category,
          offering: outcome.result.claim_offering,
          bedCount: outcome.result.claim_bed_count,
          accepting: outcome.result.claim_accepting,
          version: outcome.result.version,
          gatedBy: outcome.result.public_gated_by,
        });
      } catch (e) {
        if (e instanceof SessionExpiredError) {
          show('Signed out', TAP_AGAIN);
          return;
        }
        throw e;
      } finally {
        submitButton.disabled = false;
      }
    })();
  });

  form.append(offeringSelect, bedCountInput, acceptingLabel, reasonInput, submitButton, status);
  return form;
}

function renderHandover(holder: SessionHolder, email: string | null, wards: WardRow[]): void {
  if (root === null) return;
  const h = document.createElement('h1');
  h.textContent = 'Handover';
  const who = document.createElement('p');
  who.textContent = email === null ? 'Signed in.' : `Signed in as ${email}.`;

  const list = document.createElement('ul');
  for (const ward of wards) {
    const li = document.createElement('li');

    const summary = document.createElement('p');
    // `bedCount === null` means never reported, and is rendered as such rather
    // than as zero. Publishing "0 beds" for a ward nobody has updated states a
    // claim the facility never made.
    const beds = ward.bedCount === null ? 'not yet reporting' : `${ward.bedCount} beds`;
    summary.textContent =
      `${ward.category}: ${ward.offering}, ${beds}` +
      `${ward.accepting ? '' : ' — not accepting'}${ward.gatedBy ? ` (${ward.gatedBy})` : ''}`;

    const form = publishFormFor(holder, ward, (updated) => {
      const index = wards.findIndex((w) => w.category === ward.category);
      if (index !== -1) wards[index] = updated;
      renderHandover(holder, email, wards);
    });

    li.append(summary, form);
    list.append(li);
  }

  root.replaceChildren(h, who, list);
}

async function main(): Promise<void> {
  // THE 'NOT CONFIGURED' SCREEN IS GONE, and its absence is the improvement rather
  // than a loss. It existed because Vite replaces an unset import.meta.env read with
  // `undefined`, so a console built without the variable would have sent
  // `Bearer undefined` and reported an auth failure that had nothing to do with
  // auth. Both values are now compiled in from tracked files, so a build CANNOT
  // lack them -- the stop condition has no state left to detect.


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
    const rows = (await res.json()) as Parameters<typeof wardRowFrom>[0][];
    renderHandover(holder, holder.session?.claims.email ?? null, rows.map(wardRowFrom));
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      show('Signed out', TAP_AGAIN);
      return;
    }
    throw e;
  }
}

void main();
