import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        fs: {
            // Only needed here: this example links the package from `../..` (`file:../..`), which is
            // outside the app, and the dev server refuses to serve files from there by default. An
            // app that installs `@clickhouse/wasm-parser` into `node_modules` needs no Vite config.
            allow: ['../..'],
        },
    },
});
