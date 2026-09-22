import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER STEP 8 of docs/runbook-cloudflare-pages-beds-json.md — deleting the
 * dead `SUPABASE_URL` from the Pages project (R-2026-09-22-59 C2).
 *
 * WHY THE STEP NEEDS A GUARD AT ALL. It is the only step in that runbook that
 * DESTROYS something, and its safety rests entirely on two sentences: the gate that
 * says what must be observed first, and the re-observation that says what must be
 * observed afterwards. Either one deleted leaves a step that still reads like a
 * procedure and no longer establishes anything.
 *
 * THE SECOND IS THE ONE PEOPLE WOULD DROP, and it is the load-bearing half. Step 2
 * of the same runbook records, OBSERVED 2026-09-20, that variables bind when a
 * deployment is CREATED. So deleting the variable and seeing a 200 from the
 * deployment already running proves nothing whatever -- that deployment bound its
 * environment before anyone touched it. Without the redeploy, the step is
 * unfalsifiable: it cannot produce evidence either way.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that the step WORKS. Only the founder running it against the real project can
 *     show that, and the step is written so that its own output says which way it
 *     went. This file asserts the step still SAYS the things that make it safe.
 *   - the ORDER in which a human performs the paragraphs. Nothing in a document can
 *     enforce that; what the step does instead is make the evidence an INPUT, so the
 *     block cannot be run before the observation exists.
 */
const RUNBOOK = join(REPO_ROOT, 'docs', 'runbook-cloudflare-pages-beds-json.md');

/** Step 8's text, from its heading to the next top-level heading. */
function stepEight(markdown: string): string | undefined {
  return /^## 8\. [\s\S]*?(?=^## )/m.exec(markdown)?.[0];
}

const TEXT = readFileSync(RUNBOOK, 'utf8');

describe('runbook step 8 — deleting dead config', () => {
  test('anti-vacuity — step 8 is found, and it is not a stub', () => {
    // Without this, every assertion below would run against `undefined` and the
    // helpful ones would throw rather than the informative one firing.
    const step = stepEight(TEXT);
    expect(step, 'step 8 not found — this guard checked nothing').toBeDefined();
    expect((step ?? '').length, 'step 8 is too short to contain a gate and a re-observation').toBeGreaterThan(800);
  });

  test('it is GATED on step 5, and names what must be read back', () => {
    const step = stepEight(TEXT) ?? '';
    expect(step, 'the heading does not say it is gated').toMatch(/GATED by step 5/);
    expect(step, 'the gate does not name the status that means pass').toContain('HTTP/2 200');
    expect(step, 'the gate does not name the body prefix, so a 200 serving anything would satisfy it').toContain('{"v":');
  });

  test('it requires a REDEPLOY and a re-read AFTER the deletion — the half that makes it falsifiable', () => {
    const step = stepEight(TEXT) ?? '';
    expect(step, 'the step does not require a redeploy after the deletion').toMatch(/[Rr]edeploy/);
    expect(
      step,
      'the step does not say WHY the redeploy is required — that variables bind when a deployment is created',
    ).toMatch(/variables bind when a\s+deployment is \*\*created\*\*/);
    // THE IMPERATIVE FORM, not merely the words. A plant that weakened this to
    // "You may re-run step 5" left the loose version of this assertion GREEN while
    // the property was gone -- found by running the plant, not by reading it. The
    // difference between a required re-observation and an optional one is the whole
    // of the step's falsifiability.
    expect(step, 'the step does not REQUIRE re-running step 5 afterwards').toMatch(/\*\*Re-run step 5's block\*\*/);
    expect(step, 'the re-read is offered rather than required').not.toMatch(/may re-run step 5/i);
  });

  test('it names the variable deleted AND the one that stays', () => {
    const step = stepEight(TEXT) ?? '';
    expect(step, 'the step does not name the variable it deletes').toContain('SUPABASE_URL');
    expect(step, 'the step does not say which variable must survive').toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(step, 'the step does not tell the operator to leave the credential alone').toMatch(/Leave `SUPABASE_SERVICE_ROLE_KEY`/);
  });

  test('its failure modes are named by EXACT VALUE, never as a negation', () => {
    const step = stepEight(TEXT) ?? '';
    expect(step, 'the step does not name the wrong-variable symptom by its exact message').toContain(
      'SUPABASE_SERVICE_ROLE_KEY is not set in the Function environment',
    );
    expect(step, 'the step does not name the wrong-origin symptom').toContain('the origin rejected the snapshot read');
    // AND THE INSTRUCTION THAT MATTERS MOST: re-adding the variable to make a
    // symptom disappear would hide the finding that something still reads it.
    expect(step, 'the step does not forbid re-adding the variable to silence a symptom').toMatch(/Do not re-add the variable/);
  });

  test('its block carries NO `exit` — every fence here is pasted into an interactive shell', () => {
    // An `exit` in a pasted fence closes the operator's terminal rather than
    // stopping a script. Step 8 is the only step that had one, and it does not now.
    const step = stepEight(TEXT) ?? '';
    const fences = [...step.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
    expect(fences.length, 'step 8 carries no bash fence, so there is nothing to paste').toBeGreaterThan(0);
    for (const fence of fences) {
      expect(fence, 'a fence in step 8 calls exit, which closes the shell it is pasted into').not.toMatch(/(^|\s)exit\s/);
    }
  });

  test('plant — a step 8 with its gate sentence removed is rejected', () => {
    const planted = TEXT.replace('GATED by step 5', 'a good idea after step 5');
    expect(planted, 'the plant did not mutate the document').not.toBe(TEXT);
    expect(stepEight(planted) ?? '', 'an ungated deletion step was accepted').not.toMatch(/GATED by step 5/);
  });

  test('plant — a step 8 with its post-deletion re-read removed is rejected', () => {
    const planted = TEXT.replace("**Re-run step 5's block**", '**Optionally re-run something**');
    expect(planted, 'the plant did not mutate the document — the anchor moved').not.toBe(TEXT);
    expect(stepEight(planted) ?? '', 'a deletion step with no re-observation was accepted').not.toMatch(/Re-run step 5/);
  });
});
