import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: [
      'server/**/*.test.ts',
      'shared/**/*.test.ts',
      'client/src/**/*.test.ts',
      'client/src/**/*.test.tsx',
      'scripts/**/*.test.ts',
    ],
    // Component/render tests need a DOM. Everything else (server/shared pure
    // logic, plain .ts client tests) stays on the lightweight 'node' env.
    environmentMatchGlobs: [
      ['client/src/**/*.test.tsx', 'jsdom'],
    ],
    setupFiles: ['./client/src/test/vitest-setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'client', 'src'),
      '@shared': path.resolve(import.meta.dirname, 'shared'),
    },
  },
});
