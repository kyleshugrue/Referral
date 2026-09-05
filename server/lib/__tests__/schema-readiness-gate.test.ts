import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { DatabaseReadinessResult } from '../database-readiness';
import { createSchemaReadinessGate } from '../schema-readiness-gate';

const incompleteReadiness = (): DatabaseReadinessResult => ({
  ready: false,
  reason: 'schema-incomplete',
  missingTables: ['delivery_obligations'],
  missingColumns: ['users.account_status'],
  invalidColumns: [],
  missingIndexes: [],
  missingConstraints: [],
});

function invokeGate(
  readiness: () => DatabaseReadinessResult,
  path: string,
  headers: Record<string, string> = {},
) {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    text: undefined as string | undefined,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    type(contentType: string) {
      this.headers['content-type'] = contentType;
      return this;
    },
    send(body: string) {
      this.text = body;
      return this;
    },
  };
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  const request = {
    path,
    method: 'GET',
    headers,
  } as unknown as Request;
  createSchemaReadinessGate(readiness)(
    request,
    response as unknown as Response,
    next,
  );
  return { response, nextCalled };
}

describe('schema readiness gate', () => {
  it('keeps health and readiness diagnostics reachable', async () => {
    expect(invokeGate(incompleteReadiness, '/api/health').nextCalled).toBe(true);
    expect(invokeGate(incompleteReadiness, '/api/ready').nextCalled).toBe(true);
    expect(invokeGate(incompleteReadiness, '/internal/readiness').nextCalled).toBe(true);
  });

  it('returns a safe JSON maintenance response before authenticated middleware', async () => {
    const cookieHeader = 'referral.sid=legacy-session';
    const { response, nextCalled } = invokeGate(incompleteReadiness, '/api/user', {
      cookie: cookieHeader,
    });

    expect(nextCalled).toBe(false);
    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      status: 'not_ready',
      reason: 'schema-incomplete',
      code: 'SCHEMA_NOT_READY',
    });
    expect(JSON.stringify(response.body)).not.toContain('account_status');
    expect(JSON.stringify(response.body)).not.toContain('legacy-session');
  });

  it('returns a browser maintenance page without schema details', async () => {
    const { response } = invokeGate(incompleteReadiness, '/', {
      accept: 'text/html',
    });
    expect(response.statusCode).toBe(503);
    expect(response.text).toContain('Referral is temporarily unavailable');
    expect(response.text).toContain('try again shortly');
    expect(response.text).not.toContain('delivery_obligations');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['retry-after']).toBe('30');
  });

  it('allows requests immediately after the schema contract is restored', async () => {
    let ready = false;
    const getReadiness = () => ready
      ? {
        ready: true,
        missingTables: [],
        missingColumns: [],
        invalidColumns: [],
        missingIndexes: [],
        missingConstraints: [],
      }
      : incompleteReadiness();

    expect(invokeGate(getReadiness, '/api/user').response.statusCode).toBe(503);
    ready = true;
    expect(invokeGate(getReadiness, '/api/user').nextCalled).toBe(true);
  });
});