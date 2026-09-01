import { describe, expect, it } from 'vitest';
import {
  beginHttpRequest,
  operationalMetricsSnapshot,
  recordHttpResponse,
  recordQueueEvent,
  setQueueDepth,
} from '../operational-metrics';

describe('operational metrics', () => {
  it('tracks HTTP completion exactly once and exposes bounded queue metrics', () => {
    const complete = beginHttpRequest();
    recordHttpResponse(200);
    recordQueueEvent('jobs', 'recovered', 2);
    setQueueDepth('jobs', 4.8);
    complete();
    complete();

    const snapshot = operationalMetricsSnapshot();
    expect(snapshot.http.responsesByStatus['2xx']).toBeGreaterThanOrEqual(1);
    expect(snapshot.http.requestsInFlight).toBeGreaterThanOrEqual(0);
    expect(snapshot.queues.events['jobs.recovered']).toBeGreaterThanOrEqual(2);
    expect(snapshot.queues.depths.jobs).toBe(4);
  });
});