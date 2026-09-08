import { describe, expect, test } from 'vitest';
import { runLint, withScratch, place, REPO_ROOT } from './_scratch.js';
import {
  PLANT_JWT, PLANT_SB_SECRET, PLANT_PRIVATE_KEY, PLANT_AWS_KEY,
  PLANT_REMOTE_PG_URL, LOCAL_PG_URL,
} from './_plants.js';

/**
 * GUARD OVER A GUARD -- scripts/lint_no_secrets.sh.
 *
 * DETECTION, not prevention. GitHub secret scanning with push protection is the
 * prevention control and is a repository setting; this runs in CI, after the push
 * has already been accepted. SECURITY.md states the division; do not let it be
 * restated the other way round.
 *
 * The positive controls carry unusual weight here. This guard runs over the whole
 * repository including its own documentation, and a scan that fires on the string
 * "service_role" appearing in a comment about service_role is a scan somebody
 * turns off within a week.
 */
const LINT = 'lint_no_secrets.sh';

describe('secret scan', () => {
  test('the real repository is clean', () => {
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, res.stdout).toBe(0);
  });

  test.each([
    ['a JWT outside the allowlisted file', `const t = "${PLANT_JWT}";`],
    ['a Supabase secret key', `const k = "${PLANT_SB_SECRET}";`],
    ['a private key block', PLANT_PRIVATE_KEY],
    ['an AWS access key id', `const k = "${PLANT_AWS_KEY}";`],
    ['a REMOTE postgres URL with a password', `const u = "${PLANT_REMOTE_PG_URL}";`],
  ])('plant — %s is caught', (_name, code) => {
    withScratch((root) => {
      place(root, 'src/leak.ts', code);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
    });
  });

  test('positive control — a LOCAL postgres URL is not a finding', () => {
    // Every developer's `supabase start` uses postgres:postgres@127.0.0.1:54322,
    // it is documented in the README, and it authenticates against a container on
    // the machine running it. Firing on it would red the repository on every run.
    withScratch((root) => {
      place(root, 'scripts/run.sh', `DATABASE_URL=${LOCAL_PG_URL}`);
      expect(runLint(LINT, root).status).toBe(0);
    });
  });

  test('positive control — prose mentioning service_role is not a finding', () => {
    withScratch((root) => {
      place(root, 'docs/notes.md', 'The service_role key must never reach a client bundle.');
      expect(runLint(LINT, root).status).toBe(0);
    });
  });

  test('the allowlisted local-keys file is exempt BY PATH and only there', () => {
    withScratch((root) => {
      place(root, 'tests/setup/local-keys.ts', `export const K = '${PLANT_JWT}';`);
      expect(runLint(LINT, root).status, 'the allowlisted path was flagged').toBe(0);
    });
    withScratch((root) => {
      place(root, 'tests/setup/other-keys.ts', `export const K = '${PLANT_JWT}';`);
      expect(runLint(LINT, root).status, 'the exemption leaked to another file').toBe(1);
    });
  });

  test('anti-vacuity — an empty tree FAILS rather than reporting clean', () => {
    withScratch((root) => {
      expect(runLint(LINT, root).status).toBe(2);
    });
  });
});
