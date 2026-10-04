import { copyFileSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { robotsTxtSource, SEARCH_VISIBILITY } from '../../packages/origins/src/search.js';
import { renderNotice, type Contacts } from './privacy-notice.js';
import { fillPage } from './site-pages.js';

const REPO = resolve(import.meta.dirname, '../..');

/**
 * THE STATIC PAGES' TEXT, FOOTER AND ROBOTS TAG, WRITTEN INTO THE HTML AT BUILD TIME.
 *
 * privacy.html (R-2026-09-26-136 DL-1): docs/legal/privacy-notice-v1.1.md is the single
 * source (version 1.1 since R-2026-09-28-155 EE-2; 1.0 stays in docs/legal/, unchanged,
 * as the prior version). about.html and how-it-works.html (R-2026-09-30-190 FN-2) are
 * built the same way from docs/site/. packages/origins/contacts.json supplies every
 * openbed.ng address; privacy-notice.ts renders them. The pages carry no script, so
 * this is the only moment the text can be put into them. Exactly one placeholder in each
 * page that is meant to have it and none anywhere else, or the build stops: site-pages.ts
 * holds the table and the rule.
 *
 * SEARCH_VISIBILITY (packages/origins/src/search.ts) decides the meta robots tag of the
 * home, About and How-it-works pages and which tracked robots file becomes
 * dist/robots.txt. It decides nothing else.
 */
function staticPages(): Plugin {
  const contacts = JSON.parse(readFileSync(resolve(REPO, 'packages/origins/contacts.json'), 'utf8')) as Contacts;
  return {
    name: 'openbed-static-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        return fillPage(basename(ctx.filename), html, {
          markdown: (path) => readFileSync(resolve(REPO, path), 'utf8'),
          contacts,
          visibility: SEARCH_VISIBILITY,
          render: renderNotice,
        });
      },
    },
    // Vite has already copied public/ into dist/ by now; the file the setting selects
    // replaces the copy, byte for byte. In the hidden state that is the same file.
    closeBundle() {
      copyFileSync(resolve(REPO, robotsTxtSource(SEARCH_VISIBILITY)), resolve(import.meta.dirname, 'dist/robots.txt'));
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
  plugins: [staticPages()],
  build: {
    // Four static entries: the dashboard, the privacy notice at /privacy (DL-1 b), and
    // About and How-it-works at /about and /how-it-works (R-2026-09-30-190 FN-2).
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        privacy: resolve(import.meta.dirname, 'privacy.html'),
        about: resolve(import.meta.dirname, 'about.html'),
        'how-it-works': resolve(import.meta.dirname, 'how-it-works.html'),
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
