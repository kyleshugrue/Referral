export type ServerLifecycleState = 'starting' | 'ready' | 'draining' | 'stopped';

export type ShutdownStep = () => void | Promise<void>;

export interface ServerLifecycleOptions {
  forceShutdown?: () => void;
  forceShutdownTimeoutMs?: number;
}

/**
 * Keeps readiness state and shutdown orchestration independent from the HTTP
 * entrypoint so its state transitions remain straightforward to test.
 */
export function createServerLifecycle(options: ServerLifecycleOptions = {}) {
  let state: ServerLifecycleState = 'starting';
  let shutdownPromise: Promise<void> | undefined;

  const getState = (): ServerLifecycleState => state;
  const isReady = (): boolean => state === 'ready';

  const markReady = (): void => {
    if (state === 'starting') {
      state = 'ready';
    }
  };

  const beginShutdown = (steps: readonly ShutdownStep[]): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    state = 'draining';
    shutdownPromise = (async () => {
      const timeout = setTimeout(() => {
        options.forceShutdown?.();
      }, options.forceShutdownTimeoutMs ?? 30_000);
      timeout.unref?.();

      const errors: unknown[] = [];
      try {
        for (const step of steps) {
          try {
            await step();
          } catch (error) {
            errors.push(error);
          }
        }
      } finally {
        clearTimeout(timeout);
        state = 'stopped';
      }

      if (errors.length > 0) {
        throw new AggregateError(errors, 'One or more shutdown steps failed');
      }
    })();

    return shutdownPromise;
  };

  return { beginShutdown, getState, isReady, markReady };
}