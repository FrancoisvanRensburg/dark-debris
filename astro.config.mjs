// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // On-demand rendering so the auth routes and the auth-aware header work.
  output: 'server',
  adapter: cloudflare({
    // Exposes Cloudflare bindings/secrets via Astro.locals.runtime.env in
    // `astro dev`, reading local values from `.dev.vars`.
    platformProxy: { enabled: true },
  }),
});