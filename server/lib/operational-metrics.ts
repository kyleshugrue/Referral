type StatusClass = '2xx' | '3xx' | '4xx' | '5xx' | 'other';

const startedAt = Date.now();
let requestsTotal = 0;
let requestsInFlight = 0;
let requestDurationMsTotal = 0;
const responsesByStatus: Record<StatusClass, number> = {
  '2xx': 0,
  '3xx': 0,
  '4xx': 0,
  '5xx': 0,
  other: 0,
};

function statusClass(statusCode: number): StatusClass {
  if (statusCode >= 200 && statusCode < 300) return '2xx';
  if (statusCode >= 300 && statusCode < 400) return '3xx';
  if (statusCode >= 400 && statusCode < 500) return '4xx';
  if (statusCode >= 500 && statusCode < 600) return '5xx';
  return 'other';
}

export function beginHttpRequest(): () => void {
  const start = performance.now();
  requestsTotal += 1;
  requestsInFlight += 1;
  let completed = false;
  return () => {
    if (completed) return;
    completed = true;
    requestsInFlight = Math.max(0, requestsInFlight - 1);
    requestDurationMsTotal += performance.now() - start;
  };
}

export function recordHttpResponse(statusCode: number): void {
  responsesByStatus[statusClass(statusCode)] += 1;
}

export function operationalMetricsSnapshot() {
  const memory = process.memoryUsage();
  return {
    generatedAt: new Date().toISOString(),
    process: {
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      residentMemoryBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
    },
    http: {
      requestsTotal,
      requestsInFlight,
      averageDurationMs: requestsTotal > 0
        ? Number((requestDurationMsTotal / requestsTotal).toFixed(2))
        : 0,
      responsesByStatus: { ...responsesByStatus },
    },
  };
}