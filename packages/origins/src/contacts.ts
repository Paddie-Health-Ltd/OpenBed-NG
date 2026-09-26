import { hello } from '../contacts.json';

/**
 * THE GENERAL-ENQUIRIES ADDRESS, for the public dashboard's footer (the design-pass
 * kickoff, D1: "a footer carrying the hello@ address read from
 * packages/origins/contacts.json (BC-3), and nothing else").
 *
 * Kept in its own module, like support.ts and keys.ts, so only a bundle that imports it
 * carries it. It imports contacts.json and nothing else, so it pulls no origin string
 * into the dashboard's bundle (tests/compliance/tracked_origins.test.ts).
 *
 * A NAMED import of `hello` only, never the default import: Vite bundles a JSON default
 * import whole, and the whole file carries the ward-support address, which
 * tests/compliance/ward_support_contact.test.ts holds to the ward console's bundle alone.
 * Written as a default import first, that test caught it.
 */
export const HELLO_EMAIL: string = hello.address;
