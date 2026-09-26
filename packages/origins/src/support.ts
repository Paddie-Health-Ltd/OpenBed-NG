import CONTACTS from '../contacts.json';

/**
 * THE WARD SUPPORT ADDRESS (R-2026-09-23-67 B1). This module and contacts.ts (the
 * dashboard footer's hello address, since the design pass's D1) are the tracked file's
 * only importers in packages/; until D1 this read "sole importer".
 *
 * Kept in its own module, like keys.ts, so only a bundle that imports it carries it.
 */
export const WARD_SUPPORT_EMAIL: string = CONTACTS.support.address;
