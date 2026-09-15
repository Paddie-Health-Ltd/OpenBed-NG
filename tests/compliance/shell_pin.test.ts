import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { withScratch, place, REPO_ROOT } from './_scratch.js';

/**
 * THE SHELL PIN -- every shell script in scripts/ is bash, strict, from its
 * first command.
 *
 * WHY (founder ruling R-2026-09-15-02 item 1, R-2026-09-15-03 item 3). Five
 * verification failures in this project came from the shell running them, and
 * each was patched on its own:
 *   1. `#` in 33 runbook fences, which default interactive zsh does not treat
 *      as a comment;
 *   2. grep returning zero matches for patterns holding `$`, `{` or `?` -- a
 *      `grep` shell function defined by the agent tool's shell snapshot (a
 *      ugrep wrapper), NOT zsh semantics; a script run under bash does not
 *      inherit it;
 *   3. two test paths passed as ONE argument, because zsh does not word-split
 *      an unquoted variable (the N13 neuter run tested nothing);
 *   4. and 5. an exit status read as `${PIPESTATUS[...]}` in zsh, where it
 *      printed empty twice. zsh does not set PIPESTATUS at all; its array is
 *      `pipestatus`, and it is 1-indexed.
 * The root fix is not another patch: a verification script declares bash and
 * strict mode, and is invoked directly, never pasted into an interactive shell.
 * Runbook fences are the exception by design -- they exist to be pasted, and are
 * verified by interactive paste instead.
 *
 * THE RULE, with no exception list (R-2026-09-15-03: a guard that trusts a
 * header comment is a comment). For every file in scripts/ ending .sh:
 *   - line 1 is exactly `#!/usr/bin/env bash`;
 *   - the first line that is neither blank nor a comment is exactly
 *     `set -euo pipefail`.
 *
 * THE CORPUS IS DECLARED, THEN CHECKED (test-conventions.md §2(d)). The claim is
 * "every shell script in scripts/", and the filter is `*.sh`. So every other
 * regular file in scripts/ must be a `.mjs` -- Node, with its own guards -- or a
 * file whose first line is a bash shebang would sit outside the pin silently.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - That scripts are INVOKED with bash. `bash scripts/x.sh` and `./x.sh` both
 *     honour this; `zsh scripts/x.sh` does not, and nothing in a file can stop
 *     it. The rule is stated in test-conventions.md.
 *   - Scripts outside scripts/. There are none at the time of writing; a new
 *     location is a new declaration, not a silent extension.
 *   - `set -e`'s own limits: a failing `$(...)` inside an ARGUMENT does not
 *     abort (observed 2026-09-15). That is a property of bash, recorded in
 *     scripts/gate.sh and test-conventions.md, not a textual check.
 */

const SHEBANG = '#!/usr/bin/env bash';
const STRICT = 'set -euo pipefail';

export function pinViolations(dir: string): string[] {
  const entries = readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile()).sort();
  const shell = entries.filter((n) => n.endsWith('.sh'));
  const out: string[] = [];
  if (shell.length === 0) return [`no shell scripts found in ${dir} — the pin checked nothing`];

  for (const n of entries) {
    if (!n.endsWith('.sh') && !n.endsWith('.mjs')) {
      out.push(`${n}: not .sh or .mjs — a script under another name is outside the shell pin`);
    }
  }
  for (const n of shell) {
    const lines = readFileSync(join(dir, n), 'utf8').split('\n');
    if (lines[0] !== SHEBANG) {
      out.push(`${n}: line 1 is not ${SHEBANG} (found ${JSON.stringify(lines[0] ?? '')})`);
    }
    const first = lines.slice(1).find((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
    if (first !== STRICT) {
      out.push(`${n}: the first command is not ${STRICT} (found ${JSON.stringify(first ?? '')})`);
    }
  }
  return out;
}

const OK = `${SHEBANG}\n# header\n\n${STRICT}\necho hi\n`;

function planted(files: Record<string, string>): string[] {
  return withScratch((root) => {
    place(root, 'scripts/.placeholder-dir-marker.sh', OK);
    for (const [name, body] of Object.entries(files)) place(root, `scripts/${name}`, body);
    return pinViolations(join(root, 'scripts'));
  });
}

describe('shell pin — bash, strict, from the first command', () => {
  test('real scripts/ is accepted', () => {
    expect(pinViolations(join(REPO_ROOT, 'scripts')), 'a script in scripts/ is not pinned to bash strict mode').toEqual([]);
  });

  test('the corpus is every .sh in scripts/ and includes the two tracked verification instruments', () => {
    const names = readdirSync(join(REPO_ROOT, 'scripts'));
    expect(names.filter((n) => n.endsWith('.sh')).length, 'the corpus shrank to almost nothing').toBeGreaterThan(15);
    expect(names, 'the neuter harness is outside the pinned corpus').toContain('neuter.sh');
    expect(names, 'the aggregating gate is outside the pinned corpus').toContain('gate.sh');
  });

  test('plant — a script with no bash shebang is rejected', () => {
    const v = planted({ 'lint_x.sh': `set -euo pipefail\necho hi\n` });
    expect(v.join('\n')).toContain('lint_x.sh: line 1 is not #!/usr/bin/env bash');
  });

  test('plant — a zsh shebang is rejected', () => {
    const v = planted({ 'lint_x.sh': `#!/bin/zsh\n${STRICT}\n` });
    expect(v.join('\n')).toContain('lint_x.sh: line 1 is not #!/usr/bin/env bash (found "#!/bin/zsh")');
  });

  test('plant — set -uo pipefail without -e is rejected, with no exception for an aggregator', () => {
    const v = planted({ 'gate.sh': `${SHEBANG}\n# Exit: 0 all clear, 1 a check failed -- aggregates\nset -uo pipefail\n` });
    expect(v.join('\n')).toContain('gate.sh: the first command is not set -euo pipefail (found "set -uo pipefail")');
  });

  test('plant — a command before set -euo pipefail is rejected', () => {
    const v = planted({ 'lint_x.sh': `${SHEBANG}\ncd "$(dirname "$0")"\n${STRICT}\n` });
    expect(v.join('\n')).toContain('the first command is not set -euo pipefail');
  });

  test('plant — a shell script under another extension is rejected as outside the pin', () => {
    const v = planted({ 'helper.bash': `#!/bin/zsh\necho hi\n` });
    expect(v.join('\n')).toContain('helper.bash: not .sh or .mjs — a script under another name is outside the shell pin');
  });

  test('positive control — an ordinary pinned script with a long header is accepted', () => {
    expect(planted({ 'lint_x.sh': OK })).toEqual([]);
  });

  test('anti-vacuity — a directory with no shell scripts fails', () => {
    const v = withScratch((root) => {
      place(root, 'scripts/only.mjs', 'console.log(1);\n');
      return pinViolations(join(root, 'scripts'));
    });
    expect(v.join('\n')).toContain('no shell scripts found in');
  });
});
