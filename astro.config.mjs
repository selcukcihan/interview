import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://interview.selcukcihan.com',
  output: 'static',
  trailingSlash: 'always',
  vite: {
    plugins: [tailwindcss()]
  }
});
