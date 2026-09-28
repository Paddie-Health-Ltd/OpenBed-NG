// The one piece of jsdom the golden path uses, declared here because the package ships
// no types and @types/jsdom is not a dependency (no dependency is added for one step).
// tests/e2e/golden-path.test.ts's reporter-publishes-through-console builds a window at a
// local URL and loads the ward console into it. Nothing else in the e2e project uses jsdom.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string });
    readonly window: Window & typeof globalThis;
  }
}
