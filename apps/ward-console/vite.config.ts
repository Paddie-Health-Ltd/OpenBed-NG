import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // NOT minified, deliberately, exactly as the public dashboard is not.
    // scripts/lint_no_service_role_in_bundle.sh greps the built output for
    // credential shapes, and a minifier that mangled a string would weaken a
    // guard whose whole job is reading that output.
    minify: false,
  },
});
