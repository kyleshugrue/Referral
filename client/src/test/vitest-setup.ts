// Global Vitest setup. Applied to every test file (server, shared, and
// client) but only has an effect where a DOM is present (jsdom-environment
// .test.tsx files) — it's a no-op for plain node-environment tests.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
