import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundJobQueue } from './background-job-queue';

type TestQueue = {
  FALLBACK_POLL_INTERVAL: number;
  jobAvailableResolvers: unknown[];
  waitForJobNotification: () => Promise<void>;
  wakeAllWorkers: () => void;
};

function makeQueue() {
  const queue = new BackgroundJobQueue({} as never) as unknown as TestQueue;
  queue.FALLBACK_POLL_INTERVAL = 100;
  return queue;
}

describe('application notification waiter lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('cleans up timeout waiters and repeated idle cycles', async () => {
    vi.useFakeTimers();
    const queue = makeQueue();

    for (let cycle = 0; cycle < 8; cycle += 1) {
      const waiting = queue.waitForJobNotification();
      expect(queue.jobAvailableResolvers).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(100);
      await waiting;
      expect(queue.jobAvailableResolvers).toHaveLength(0);
    }
  });

  it('wakes fifty parallel waiters and clears their timers', async () => {
    vi.useFakeTimers();
    const queue = makeQueue();
    const waiters = Array.from({ length: 50 }, () => queue.waitForJobNotification());

    expect(queue.jobAvailableResolvers).toHaveLength(50);
    queue.wakeAllWorkers();
    await Promise.all(waiters);

    expect(queue.jobAvailableResolvers).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});