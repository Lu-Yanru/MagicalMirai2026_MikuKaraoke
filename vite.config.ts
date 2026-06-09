import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  base:
    command === 'build'
      ? '/MagicalMirai2026_MikuKaraoke/'
      : '/',
}))
