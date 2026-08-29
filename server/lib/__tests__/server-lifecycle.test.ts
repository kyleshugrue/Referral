import { describe, expect, it, vi } from 'vitest';
import { createServerLifecycle } from '../server-lifecycle';

describe('server lifecycle', () => {
  it('is not ready during startup or drain', async () => {
    const lifecycle = createServerLifecycle();

    expect(lifecycle.getState()).toBe('starting');
    expect(lifecycle.isReady()).toBe(false);

    lifecycle.markReady();
    expect(lifecycle.isReady()).toBe(true);

    const shutdown = lifecycle.beginShutdown([async () => undefined]);
    expect(lifecycle.getState()).toBe('draining');
    expect(lifecycle.isReady()).toBe(false);

    await shutdown;
    expect(lifecycle.getState()).toBe('stopped');
    expect(lifecycle.isReady()).toBe(false);
  });

  it('runs shutdown steps once and in order for duplicate requests', async () => {
    const lifecycle = createServerLifecycle();
    const calls: string[] = [];
    const first = vi.fn(async () => { calls.push('websocket'); });
    const second = vi.fn(async () => { calls.push('background-jobs'); });
    const third = vi.fn(async () => { calls.push('database'); });

    const shutdown = lifecycle.beginShutdown([first, second, third]);
    const duplicateShutdown = lifecycle.beginShutdown([vi.fn()]);

    expect(duplicateShutdown).toBe(shutdown);
    await shutdown;
    expect(calls).toEqual(['websocket', 'background-jobs', 'database']);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
  });
});