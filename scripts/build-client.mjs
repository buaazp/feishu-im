import { build } from 'esbuild'
await build({
  entryPoints: ['src/client.tsx'], outfile: 'dist/client.cjs', bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
  external: ['react'], sourcemap: true,
  banner: { js: 'window.__ModuleLoader__.load({ id: "dsh-feishu-im", factory: (require) => { const module = { exports: {} }; const exports = module.exports;' },
  footer: { js: 'return module.exports; } });' },
})
