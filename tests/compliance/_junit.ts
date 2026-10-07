/**
 * A READER FOR THE JUnit A CHILD vitest WRITES (R-2026-10-07 GI, GJ). Shared by the tests that run a real
 * child vitest over scratch files (compliance_guard.test.ts, dashboard_never_blank_antivacuity.test.ts), so
 * the one rule lives once: a run that collected nothing is REFUSED, because a reader that returned an empty
 * list would pass every "no failure" assertion made over it.
 */

export interface Case {
  file: string;
  name: string;
  failed: boolean;
  body: string;
}

const decode = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#10;/g, '\n').replace(/&amp;/g, '&');

/** Reads a JUnit file into cases. REFUSES a run that collected nothing: an empty reader would pass every "no failure" assertion. */
export function readCases(xml: string): Case[] {
  const out: Case[] = [];
  const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of xml.matchAll(re)) {
    const attrs = m[1] ?? '';
    const body = decode(m[2] ?? '');
    out.push({
      file: /classname="([^"]*)"/.exec(attrs)?.[1] ?? '',
      // `(?:^|\s)` keeps this from matching inside classname="...", which comes first in the attributes: the
      // first version of this reader returned the CLASSNAME as the case's name, unnoticed because the guard
      // tests read the failure body, and found when a test needed to tell cases apart by name (R-2026-10-07 GJ).
      name: decode(/(?:^|\s)name="([^"]*)"/.exec(attrs)?.[1] ?? ''),
      failed: /<(failure|error)\b/.test(m[2] ?? ''),
      body,
    });
  }
  if (out.length === 0) throw new Error('ERROR: the child vitest collected no test cases, so no verdict can be read from it');
  return out;
}
