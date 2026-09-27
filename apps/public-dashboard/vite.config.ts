import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { renderNotice, type Contacts } from './privacy-notice.js';

const REPO = resolve(import.meta.dirname, '../..');
const PLACEHOLDER = '<!-- @PRIVACY_NOTICE@ -->';

/**
 * THE PRIVACY NOTICE, WRITTEN INTO privacy.html AT BUILD TIME (R-2026-09-26-136 DL-1).
 * docs/legal/privacy-notice-v1.0.md is the single source and
 * packages/origins/contacts.json supplies every openbed.ng address; privacy-notice.ts
 * renders them. The page carries no script, so this is the only moment the notice can
 * be put into it. Exactly one placeholder in privacy.html and none anywhere else, or the
 * build stops: a notice written twice, or into the dashboard, is a build error.
 */
function privacyNotice(): Plugin {
  return {
    name: 'openbed-privacy-notice',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const count = html.split(PLACEHOLDER).length - 1;
        const isNotice = ctx.filename.endsWith('/privacy.html');
        if (!isNotice) {
          if (count !== 0) throw new Error(`${ctx.filename}: the privacy-notice placeholder belongs in privacy.html only`);
          return html;
        }
        if (count !== 1) throw new Error(`privacy.html: expected exactly one privacy-notice placeholder, found ${count}`);
        const markdown = readFileSync(resolve(REPO, 'docs/legal/privacy-notice-v1.0.md'), 'utf8');
        const contacts = JSON.parse(readFileSync(resolve(REPO, 'packages/origins/contacts.json'), 'utf8')) as Contacts;
        return html.replace(PLACEHOLDER, renderNotice(markdown, contacts));
      },
    },
  };
}

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
  plugins: [privacyNotice()],
  build: {
    // Two static entries: the dashboard, and the privacy notice at /privacy (DL-1 b).
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        privacy: resolve(import.meta.dirname, 'privacy.html'),
      },
    },
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
