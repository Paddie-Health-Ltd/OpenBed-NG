import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Readable output. The bundle guards in scripts/lint_no_service_role_in_bundle.sh
    // and scripts/lint_no_updated_at_filter.sh grep this directory, and while both
    // would still match a minified identifier, an unminified bundle makes a
    // failure legible to whoever has to fix it.
    minify: false,
  },
});
