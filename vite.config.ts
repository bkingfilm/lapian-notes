import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { subtitleFinderPlugin } from './subtitle-server-plugin'
import { transcodeServerPlugin } from './transcode-server-plugin'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), subtitleFinderPlugin(), transcodeServerPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // 在线试用版(GitHub Pages)构建时置 ONLINE_DEMO=1,应用内据此显示在线版说明与完整版差异
    __ONLINE_DEMO__: JSON.stringify(process.env.ONLINE_DEMO === '1'),
  },
})
