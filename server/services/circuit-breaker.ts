/**
 * Circuit Breaker Pattern Implementation
 * 
 * Protects against cascading failures by monitoring operation success/failure rates
 * and temporarily blocking requests when failures exceed threshold.
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failures detected, requests rejected immediately
 * - HALF_OPEN: Testing recovery, limited requests allowed
 */

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
}

export interface CircuitBreakerMetrics {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  stateChanges: number;
  currentState: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastStateChange: Date | null;
  lastFailure: Date | null;
  lastSuccess: Date | null;
}

export type StateChangeCallback = (
  oldState: CircuitState,
  newState: CircuitState,
  metrics: CircuitBreakerMetrics
) => void;

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker<T = unknown> {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private consecutiveFailures: number = 0;
  private consecutiveSuccesses: number = 0;
  private lastStateChange: Date | null = null;
  private lastFailure: Date | null = null;
  private lastSuccess: Date | null = null;
  private nextAttemptTime: number = 0;
  private totalCalls: number = 0;
  private stateChanges: number = 0;
  private stateChangeCallbacks: StateChangeCallback[] = [];

  constructor(
    private config: CircuitBreakerConfig = {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 30000
    }
  ) {
    console.log('[CircuitBreaker] Initialized with config:', config);
  }

  /**
   * Register a callback for state changes
   */
  onStateChange(callback: StateChangeCallback): void {
    this.stateChangeCallbacks.push(callback);
  }

  /**
   * Execute an operation through the circuit breaker
   */
  async execute<R = T>(operation: () => Promise<R>): Promise<R> {
    this.totalCalls++;

    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        throw new CircuitBreakerError(
          'Circuit breaker is OPEN - Claude API is temporarily unavailable'
        );
      }
      this.transitionTo(CircuitState.HALF_OPEN);
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.successCount++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.lastSuccess = new Date();

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    this.failureCount++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailure = new Date();

    if (this.state === CircuitState.CLOSED || this.state === CircuitState.HALF_OPEN) {
      if (this.consecutiveFailures >= this.config.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    
    if (oldState === newState) {
      return;
    }

    this.state = newState;
    this.lastStateChange = new Date();
    this.stateChanges++;

    if (newState === CircuitState.OPEN) {
      this.nextAttemptTime = Date.now() + this.config.timeout;
      console.log(
        `[CircuitBreaker] State: ${oldState} -> ${newState} (will retry after ${this.config.timeout}ms)`
      );
    } else if (newState === CircuitState.HALF_OPEN) {
      this.consecutiveSuccesses = 0;
      console.log(`[CircuitBreaker] State: ${oldState} -> ${newState} (testing recovery)`);
    } else if (newState === CircuitState.CLOSED) {
      this.consecutiveFailures = 0;
      console.log(`[CircuitBreaker] State: ${oldState} -> ${newState} (normal operation)`);
    }

    this.notifyStateChange(oldState, newState);
  }

  /**
   * Notify all registered callbacks of state change
   */
  private notifyStateChange(oldState: CircuitState, newState: CircuitState): void {
    const metrics = this.getMetrics();
    
    for (const callback of this.stateChangeCallbacks) {
      try {
        callback(oldState, newState, metrics);
      } catch (error) {
        console.error('[CircuitBreaker] Error in state change callback:', error);
      }
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    return {
      totalCalls: this.totalCalls,
      successCount: this.successCount,
      failureCount: this.failureCount,
      stateChanges: this.stateChanges,
      currentState: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastStateChange: this.lastStateChange,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Reset circuit breaker to initial state (for testing/manual intervention)
   */
  reset(): void {
    console.log('[CircuitBreaker] Manually reset to CLOSED state');
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.nextAttemptTime = 0;
  }
}
