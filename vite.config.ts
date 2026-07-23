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
  },
})
