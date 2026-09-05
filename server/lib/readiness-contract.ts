export type ReadinessLifecycleState = 'starting' | 'draining' | 'ready';

export interface PublicReadinessResponse {
  statusCode: 200 | 503;
  body: {
    ready: boolean;
    reason?: 'starting' | 'draining' | 'schema_not_ready' | 'queue_unavailable';
  };
}

/**
 * Keep deployment probes useful without disclosing schema topology or queue
 * volume. Detailed diagnostics are served separately behind internal auth.
 */
export function getPublicReadinessResponse(
  lifecycleState: ReadinessLifecycleState,
  schemaReady: boolean,
  queueAvailable: boolean,
): PublicReadinessResponse {
  if (lifecycleState !== 'ready') {
    return {
      statusCode: 503,
      body: { ready: false, reason: lifecycleState },
    };
  }

  if (!schemaReady) {
    return {
      statusCode: 503,
      body: { ready: false, reason: 'schema_not_ready' },
    };
  }

  if (!queueAvailable) {
    return {
      statusCode: 503,
      body: { ready: false, reason: 'queue_unavailable' },
    };
  }

  return { statusCode: 200, body: { ready: true } };
}