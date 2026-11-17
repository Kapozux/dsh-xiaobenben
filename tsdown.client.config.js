// 浏览器这一半：打成 dsh 客户端模块加载器要的格式（一个 factory 闭包，外部模块从注入的 require 拿）。
// 照 dsh-usage-calendar 的 tsdown.client.config.ts；dsh 自己的 clientBundle 预设没发布，只能这样复刻（docs/dsh-api.md §2.1）。
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { client: 'src/client/index.jsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: false,
  clean: false,
  deps: {
    neverBundle: ['react', 'react/jsx-runtime', 'react-dom'],
  },
  inputOptions: {
    transform: { jsx: { runtime: 'automatic' } },
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-agent-year", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
