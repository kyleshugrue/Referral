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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'server/lib/http-security.ts',
        'server/lib/internal-auth.ts',
        'server/lib/register-auth.ts',
        'server/lib/upload-validation.ts',
        'server/lib/websocket-security.ts',
        'server/lib/websocket-tickets.ts',
        'server/middleware/auth-jwt.ts',
        'server/middleware/require-admin.ts',
        'server/middleware/require-complete-registration.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/test-support/**'],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 55,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'client', 'src'),
      '@shared': path.resolve(import.meta.dirname, 'shared'),
    },
  },
});
