import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from https://<user>.github.io/roost/, so assets resolve under /roost/.
// Build lands in dist/ and ships to Pages via the deploy workflow, so nothing
// generated is committed to the repo.
export default defineConfig({
  base: '/roost/',
  plugins: [react()],
  build: { outDir: 'dist' }
});
