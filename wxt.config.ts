import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'Font Grab',
    description: 'Detect, preview, and export web fonts',
    permissions: ['storage', 'scripting', 'declarativeNetRequest', 'downloads', 'tabs'],
    host_permissions: ['<all_urls>'],
  },
});
