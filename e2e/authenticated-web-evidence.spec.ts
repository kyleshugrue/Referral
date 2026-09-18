import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

type EvidenceLog = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  responses: Array<{ method: string; path: string; status: number }>;
};

const smokeUser = {
  id: 900001,
  email: 'ci-smoke-user@example.invalid',
  fullName: 'CI Smoke User',
  birthday: '1990-01-01',
  title: 'Synthetic Tester',
  currentLocation: 'New York',
  currentLocationLat: null,
  currentLocationLng: null,
  desiredLocations: [],
  desiredLocationCoords: [],
  industry: 'Technology',
  currentCompany: 'Synthetic Co',
  desiredCompanies: [],
  matchingRadius: 25,
  yearsOfExperience: 5,
  bio: 'Synthetic browser smoke identity',
  photo: '/app-icon-192.png',
  resumeUrl: null,
  resumePreviewUrls: [],
  interests: [],
  professionalInterests: [],
  languages: ['English'],
  profileVisible: true,
  emailNotifications: false,
  readReceipts: true,
  emailVerificationStarted: true,
  emailVerified: true,
  registrationCompleted: true,
  hasMinimumMatchData: true,
  profileVersion: 1,
  currentSnapshotId: null,
  initialMatchJobsQueued: false,
  initialMatchJobsQueuedAt: null,
  firebaseUid: 'ci-smoke-firebase-uid',
};

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

async function attachEvidence(testInfo: TestInfo, evidence: EvidenceLog & {
  viewport: string;
  fixture: string;
  assistiveTechnology: string;
  notes: string[];
}) {
  const body = Buffer.from(JSON.stringify(evidence, null, 2));
  const path = testInfo.outputPath('authenticated-web-evidence.json');
  await writeFile(path, body);
  await testInfo.attach('authenticated-web-evidence.json', {
    contentType: 'application/json',
    path,
  });
}

async function installEvidenceRoutes(page: Page, evidence: EvidenceLog) {
  let retryAttempts = 0;
  let idempotentMessage: Record<string, unknown> | undefined;

  page.on('console', (message) => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text().slice(0, 240));
  });
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message.slice(0, 240)));
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtag/js') return;
    if (
      (url.pathname === '/api/user' || url.pathname === '/api/timeout-recovery') &&
      request.failure()?.errorText === 'net::ERR_ABORTED'
    ) return;
    evidence.failedRequests.push(`${request.method()} ${url.pathname}`);
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400 || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__smoke/')) {
      evidence.responses.push({
        method: response.request().method(),
        path: url.pathname,
        status: response.status(),
      });
    }
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === '/api/user' && method === 'GET') {
      await route.fulfill(json(smokeUser));
      return;
    }
    if (url.pathname === '/api/user' && method === 'PATCH') {
      await route.fulfill(json({ ...smokeUser, bio: 'Edited synthetic profile' }));
      return;
    }
    if (url.pathname === '/api/user' && method === 'DELETE') {
      await route.fulfill(json({ status: 'pending', message: 'Synthetic erasure queued' }, 202));
      return;
    }
    if (url.pathname === '/api/csrf-token') {
      await route.fulfill(json({ csrfToken: 'synthetic-csrf-token' }));
      return;
    }
    if (url.pathname === '/api/notifications/counts') {
      await route.fulfill(json({ messages: 1, connectionRequests: 1, newConnections: 0 }));
      return;
    }
    if (url.pathname === '/api/matches' && url.searchParams.has('evidence-retry')) {
      retryAttempts += 1;
      await route.fulfill(retryAttempts === 1 ? json({ message: 'temporary provider timeout' }, 503) : json([]));
      return;
    }
    if (url.pathname.startsWith('/api/messages/') && method === 'POST') {
      const key = request.headers()['idempotency-key'] || 'synthetic-key';
      idempotentMessage ??= {
        id: 990001,
        conversationId: 990001,
        senderId: smokeUser.id,
        receiverId: 900002,
        content: 'Synthetic retry-safe message',
        idempotencyKey: key,
        status: 'sent',
      };
      await route.fulfill(json(idempotentMessage, 201));
      return;
    }
    if (url.pathname === '/api/upload/profile-picture' && method === 'POST') {
      await route.fulfill(json({ url: '/api/media/c2VudGhldGljLXBob3Rv', fileName: 'profile-pictures/synthetic-replacement.jpg' }));
      return;
    }
    if (url.pathname === '/api/auth/revoke' || url.pathname === '/api/auth/revoke-all') {
      await route.fulfill(json({ revoked: true }));
      return;
    }
    if (url.pathname === '/api/auth/ws-ticket') {
      await route.fulfill(json({ ticket: 'synthetic-websocket-ticket', expiresInSeconds: 60 }));
      return;
    }
    if (url.pathname === '/api/timeout-recovery') {
      await new Promise((resolve) => setTimeout(resolve, 75));
      await route.fulfill(json({ recovered: true }));
      return;
    }
    if (method === 'GET') {
      await route.fulfill(json([]));
      return;
    }
    await route.fulfill(json({ ok: true }));
  });
}

async function auditVisibleControls(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        (element as HTMLElement).offsetParent !== null;
    };
    const accessibleName = (element: Element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        return labelledBy.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
      }
      return element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        (element as HTMLInputElement).labels?.[0]?.textContent?.trim() ||
        element.textContent?.trim() ||
        '';
    };
    const failures: string[] = [];
    const ids = new Set<string>();
    document.querySelectorAll('[id]').forEach((element) => {
      if (ids.has(element.id)) failures.push(`duplicate id: ${element.id}`);
      ids.add(element.id);
    });
    document.querySelectorAll('img').forEach((element) => {
      if (visible(element) && !element.hasAttribute('alt')) failures.push('image missing alt');
    });
    document.querySelectorAll('button, a, input, select, textarea, [role="button"]').forEach((element) => {
      if (visible(element) && !accessibleName(element)) {
        failures.push(`${element.tagName.toLowerCase()} missing accessible name`);
      }
      if (visible(element) && !(element as HTMLInputElement).disabled) {
        const rect = element.getBoundingClientRect();
        if (rect.width < 24 || rect.height < 24) {
          failures.push(`${element.tagName.toLowerCase()} touch target below 24px (${Math.round(rect.width)}x${Math.round(rect.height)}; ${element.className})`);
        }
      }
    });
    document.querySelectorAll('input, select, textarea').forEach((element) => {
      if (!visible(element) || element.getAttribute('type') === 'hidden') return;
      if (!element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') &&
        !(element as HTMLInputElement).labels?.length) {
        failures.push(`${element.tagName.toLowerCase()} missing label`);
      }
    });
    const focusable = Array.from(document.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )).filter((element) => visible(element) && !element.matches(':disabled'));
    for (const element of focusable) {
      element.focus();
      if (document.activeElement !== element) continue;
      const style = window.getComputedStyle(element);
      const outline = style.outlineStyle !== 'none' && style.outlineWidth !== '0px';
      const focusRing = style.boxShadow !== 'none';
      if (!outline && !focusRing && !element.matches(':focus-visible')) {
        failures.push(`${element.tagName.toLowerCase()} has no visible focus indicator`);
      }
    }
    return {
      failures,
      focusableCount: focusable.length,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  });
}

test.describe('authenticated web accessibility evidence', () => {
  test('runs the synthetic desktop/mobile journey and boundary matrix', async ({ page }, testInfo) => {
    testInfo.setTimeout(90_000);
    const evidence: EvidenceLog = {
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      responses: [],
    };

    const health = await page.request.get('/api/health');
    const readiness = await page.request.get('/api/ready');
    expect(health.status()).toBe(200);
    expect(await health.text()).toBe('OK');
    expect(readiness.status()).toBe(200);
    expect(await readiness.json()).toEqual({ ready: true });

    const unauthenticatedContext = await page.context().browser()?.newContext();
    expect(unauthenticatedContext).toBeTruthy();
    if (!unauthenticatedContext) throw new Error('Unable to create isolated unauthenticated context');
    const unauthenticatedApi = await unauthenticatedContext.request.get('/api/user');
    expect(unauthenticatedApi.status()).toBe(401);
    const unauthenticatedTicket = await unauthenticatedContext.request.post('/api/auth/ws-ticket');
    expect(unauthenticatedTicket.status()).toBe(401);
    const unauthenticatedMedia = await unauthenticatedContext.request.get('/api/media/c2VudGhldGljLXBob3Rv');
    expect([401, 404]).toContain(unauthenticatedMedia.status());
    await unauthenticatedContext.close();

    await page.goto('/auth/register');
    await page.getByTestId('input-email').fill('synthetic-registration@example.invalid');
    await page.getByTestId('input-password').fill('StrongPass1!');
    await page.goto('/verify-email');
    await expect(page.getByText('Email Verification', { exact: true })).toBeVisible();

    const smokeSession = await page.request.get('/__smoke/session');
    expect(smokeSession.status()).toBe(200);
    await page.goto('/__smoke/session');
    const cookies = await page.context().cookies();
    const smokeCookie = cookies.find((cookie) => cookie.name === 'smoke-auth' || cookie.name === '__Host-smoke-auth');
    expect(smokeCookie).toMatchObject({ httpOnly: true, path: '/' });

    await installEvidenceRoutes(page, evidence);
    try {
      await page.goto('/profile');
      await expect(page.getByText('CI Smoke User', { exact: true }).first()).toBeVisible();
      const profileAudit = await auditVisibleControls(page);
      expect(profileAudit.failures, 'Profile accessibility failures').toEqual([]);
      expect(profileAudit.scrollWidth).toBeLessThanOrEqual(profileAudit.viewportWidth + 1);
      await page.screenshot({ path: testInfo.outputPath('profile.png'), fullPage: true });

      const csrfToken = await page.evaluate(async () => {
        const response = await fetch('/api/csrf-token');
        return (await response.json() as { csrfToken: string }).csrfToken;
      });
      expect(csrfToken).toBe('synthetic-csrf-token');
      const profileUpdate = await page.evaluate(async (token) => {
        const response = await fetch('/api/user', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
          body: JSON.stringify({ bio: 'Edited synthetic profile' }),
        });
        return { status: response.status, body: await response.json() };
      }, csrfToken);
      expect(profileUpdate.status).toBe(200);
      expect(profileUpdate.body.bio).toBe('Edited synthetic profile');

      for (const route of ['/network/search', '/matches/suggestions', '/connections', '/chat/900002', '/settings']) {
        await page.goto(route);
        await expect(page.locator('body')).toBeVisible();
        const audit = await auditVisibleControls(page);
        expect(audit.failures, `${route} accessibility failures`).toEqual([]);
        expect(audit.scrollWidth).toBeLessThanOrEqual(audit.viewportWidth + 1);
      }

      const retryResult = await page.evaluate(async () => {
        const first = await fetch('/api/matches?evidence-retry=1');
        const second = await fetch('/api/matches?evidence-retry=1');
        return [first.status, second.status];
      });
      expect(retryResult).toEqual([503, 200]);

      const timeoutResult = await page.evaluate(async () => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 10);
        try {
          await fetch('/api/timeout-recovery', { signal: controller.signal });
          return 'unexpected-success';
        } catch {
          return 'aborted-and-retryable';
        } finally {
          window.clearTimeout(timer);
        }
      });
      expect(timeoutResult).toBe('aborted-and-retryable');

      const key = 'synthetic-idempotency-key-276';
      const messages = await page.evaluate(async (idempotencyKey) => {
        const init: RequestInit = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ content: 'Synthetic retry-safe message' }),
        };
        const first = await fetch('/api/messages/900002', init);
        const firstBody = await first.json();
        const second = await fetch('/api/messages/900002', init);
        const secondBody = await second.json();
        return { firstStatus: first.status, secondStatus: second.status, firstBody, secondBody };
      }, key);
      expect(messages.firstStatus).toBe(201);
      expect(messages.secondStatus).toBe(201);
      expect(messages.firstBody).toEqual(messages.secondBody);

      const media = await page.evaluate(async () => {
        const form = new FormData();
        form.append('photo', new Blob(['synthetic-media'], { type: 'image/jpeg' }), 'synthetic-replacement.jpg');
        const first = await fetch('/api/upload/profile-picture', { method: 'POST', body: form });
        const second = await fetch('/api/upload/profile-picture', { method: 'POST', body: form });
        return { first: await first.json(), second: await second.json() };
      });
      expect(media.first.url).toMatch(/^\/api\/media\//);
      expect(media.second.url).toBe(media.first.url);

      const logout = await page.evaluate(async () => {
        const response = await fetch('/api/auth/revoke', {
          method: 'POST',
          headers: { 'X-CSRF-Token': 'synthetic-csrf-token' },
        });
        return response.status;
      });
      expect(logout).toBe(200);
      await page.goto('/__smoke/session');
      await page.goto('/profile');
      await expect(page.getByText('CI Smoke User', { exact: true }).first()).toBeVisible();

      const erasure = await page.evaluate(async (token) => {
        const response = await fetch('/api/user', {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': token },
        });
        return response.status;
      }, csrfToken);
      expect(erasure).toBe(202);

      await page.emulateMedia({ reducedMotion: 'reduce' });
      const reducedMotionAudit = await auditVisibleControls(page);
      expect(reducedMotionAudit.reducedMotion).toBe(true);
      expect(reducedMotionAudit.failures).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('reduced-motion.png'), fullPage: true });
    } finally {
      if (!page.isClosed()) await page.unroute('**/api/**');
    }

    const expectedRetryConsoleErrors = evidence.consoleErrors.filter((message) =>
      message.includes('status of 503 (Service Unavailable)'),
    );
    expect(expectedRetryConsoleErrors).toHaveLength(1);
    expect(evidence.consoleErrors.filter((message) =>
      !message.includes('status of 503 (Service Unavailable)'),
    )).toEqual([]);
    expect(evidence.pageErrors).toEqual([]);
    expect(evidence.failedRequests).toEqual([]);
    await attachEvidence(testInfo, {
      ...evidence,
      viewport: testInfo.project.name,
      fixture: 'CI-only smoke-auth / synthetic user 900001; no Firebase, production session, provider, or media service',
      assistiveTechnology: 'Not available in this Linux browser runner; screen-reader pass remains explicitly pending',
      notes: [
        'Registration and verification screens were exercised without submitting Firebase credentials.',
        'UI API responses for retry, timeout, idempotency, media replacement, logout, and erasure were synthetic browser-scoped fixtures.',
        'The single 503 console entry is the intentionally induced provider-timeout retry and is retained as recovery evidence.',
        'Unauthenticated user, WebSocket-ticket, and media requests hit the real server and returned safe failures.',
        'Group chat HTTP 410 and full production authorization/DTO/media/WebSocket invariants remain covered by the repository security suites, not claimed from the synthetic UI seam.',
      ],
    });
  });
});