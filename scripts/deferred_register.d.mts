/**
 * Types for `deferred_register.mjs`, so a TypeScript test can import the register's
 * parser rather than keep a second copy of it (R-2026-09-29-171, EU-3 a). The
 * precedent is `eslint.config.d.mts`.
 *
 * DELIBERATELY NARROW. Only what the module exports is declared. `KINDS` is declared
 * as the exact tuple, so a caller that narrows a string against it keeps the literal
 * types the test file had with `as const`.
 */
export declare const SECTION: string;
export declare const HEADER: string;
export declare const KINDS: readonly ['BOX', 'TRIGGER', 'VERSION'];

export interface Row {
  item: string;
  ruling: string;
  kind: string;
  gate: string;
  line: number;
}

/** The register's rows, and every way the table failed to parse. */
export declare function parseRegister(record: string): { rows: Row[]; errors: string[] };
