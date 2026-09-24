import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { lagosTime } from '@openbed/snapshot';
import { REPO_ROOT } from './_scratch.js';

/**
 * LAGOS TIME IS LAGOS TIME, WHATEVER ZONE THE DEVICE IS IN (R-2026-09-24-97 BY-2 c;
 * PR 3.4b-app C).
 *
 * packages/snapshot/src/time.ts's lagosTime is shared by the public dashboard and the
 * admin app. The operator is often in Hong Kong, so the admin app runs on a device
 * whose zone is eight hours from Lagos; a formatter that fell back to the device zone
 * would show every time eight hours out, and nothing on the page would look wrong.
 *
 * THE ZONE IS SET ON A CHILD PROCESS, never on this one: TZ is read when the process
 * starts, and changing process.env.TZ inside a running test changes nothing reliably.
 * So the formatter is run in a fresh `node` under TZ=Asia/Hong_Kong, and again under
 * TZ=UTC as the control, and both must print what this process prints.
 *
 * NOT ASSERTED HERE, deliberately (method note 12): that a real phone in Hong Kong
 * renders it so. The browser's Intl is the same ICU data Node ships, which is the
 * premise; a device whose ICU lacks Africa/Lagos would throw, not drift.
 */

const TIME_TS = join(REPO_ROOT, 'packages', 'snapshot', 'src', 'time.ts');
const INSTANTS = ['2026-09-24T22:59:59.000Z', '2026-12-31T23:30:00.000Z', '2026-06-15T04:12:00.000Z'];

function inZone(tz: string): { status: number; out: string; err: string } {
  const script = `import { lagosTime } from ${JSON.stringify(TIME_TS)};\nfor (const i of ${JSON.stringify(INSTANTS)}) console.log(lagosTime(i));`;
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, TZ: tz },
  });
  return { status: r.status ?? -1, out: r.stdout, err: r.stderr };
}

describe('lagosTime', () => {
  const expected = INSTANTS.map((i) => lagosTime(i)).join('\n') + '\n';

  test('real formatter under TZ=Asia/Hong_Kong prints Lagos time, identical to this process', () => {
    const hk = inZone('Asia/Hong_Kong');
    expect(hk.status, hk.err).toBe(0);
    expect(hk.out).toBe(expected);
  });

  test('control — the same under TZ=UTC, so the comparison is not vacuous', () => {
    const utc = inZone('UTC');
    expect(utc.status, utc.err).toBe(0);
    expect(utc.out).toBe(expected);
  });

  test('plant — a formatter that uses the DEVICE zone differs under Hong Kong, so the child really ran in it', () => {
    const script = `for (const i of ${JSON.stringify(INSTANTS)}) console.log(new Date(i).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, day: 'numeric', month: 'short' }) + ' (Lagos time)');`;
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, TZ: 'Asia/Hong_Kong' } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout, 'the device-zone formatter printed Lagos time, so TZ did not reach the child').not.toBe(expected);
  });

  test('the ordinary case reads as a Lagos wall time', () => {
    // 22:59:59 UTC is 23:59 in Lagos (UTC+1, no daylight saving) and 06:59 next day in Hong Kong.
    expect(lagosTime('2026-09-24T22:59:59.000Z')).toBe('24 Sept, 23:59 (Lagos time)');
  });
});
