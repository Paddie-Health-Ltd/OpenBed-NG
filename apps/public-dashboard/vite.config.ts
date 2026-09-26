import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  // NO ENVIRONMENT REACHES A BUILD OF THIS APP (R-2026-09-22-60, -61 B3).
  //
  // `envDir: false` stops Vite reading .env, .env.local, .env.<mode> and
  // .env.<mode>.local, so an untracked file on one machine cannot change what the
  // bundle talks to. It is the typed, non-deprecated option: `envFile: false` warns
  // and is scheduled for removal in the pinned Vite 8.2.2.
  //
  // `envPrefix` NAMES A PREFIX THIS PROJECT NEVER USES, and that half is the one
  // that matters. envDir only closes the FILE route: Vite copies every prefixed
  // `process.env` entry into the record afterwards, and it OUTRANKS every file, so
  // without this a variable exported in the operator's shell would still reach the
  // bundle. With no prefix in use, nothing is exposed by either route.
  //
  // NEITHER IS THE LOAD-BEARING GUARANTEE. That is the absence of any
  // `import.meta.env` READ in this app's source, asserted in
  // tests/compliance/tracked_client_keys.test.ts: with no read, Vite's define never
  // fires and no env record is emitted at all. These two are the belt, kept so a
  // future read cannot quietly reopen the route.
  envDir: false,
  envPrefix: ['OPENBED_NO_BUILD_ENV_'],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Readable output. The bundle guards in scripts/lint_no_service_role_in_bundle.sh
    // and scripts/lint_no_updated_at_filter.sh grep this directory, and while both
    // would still match a minified identifier, an unminified bundle makes a
    // failure legible to whoever has to fix it.
    minify: false,
    // Every asset is emitted as a same-origin file, never inlined as a data: URI (the
    // design pass, D1). The CSP's font source is default-src 'self', which a data: font
    // would fail silently, and the mark in index.html stays a file the browser caches.
    assetsInlineLimit: 0,
  },
});
