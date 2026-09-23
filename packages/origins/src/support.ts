import SUPPORT from '../ward-support.json';

/**
 * THE WARD SUPPORT ADDRESS (R-2026-09-23-67 B1) -- this module is the tracked file's
 * sole importer, as index.ts is for origins.json.
 *
 * Kept in its own module, like keys.ts, so only a bundle that imports it carries it.
 */
export const WARD_SUPPORT_EMAIL: string = SUPPORT.address;
