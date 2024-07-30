import { defineConfig } from 'vite'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        lib: {
          entry: resolve(__dirname, 'src/main.js'),
          formats: ["es"],
          name: 'Renkon',
          fileName: 'renkon',
        },
    }
})
