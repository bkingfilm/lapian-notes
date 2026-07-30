/// <reference types="vite/client" />

// 由 vite.config.ts 的 define 注入,值取自 package.json 的 version
declare const __APP_VERSION__: string
// 由 vite.config.ts 的 define 注入,GitHub Pages 在线试用版构建时为 true
declare const __ONLINE_DEMO__: boolean
