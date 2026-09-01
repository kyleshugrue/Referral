import { test, expect } from '@playwright/test';

/**
 * Desktop + mobile smoke test of the primary journey:
 *   landing -> registration -> one core action (live password strength
 *   feedback as the user types).
 *
 * Deliberately never submits the registration/login form - doing so would
 * call the real Firebase project configured for this app. Everything
 * exercised here is client-side only.
 *
 * Run with: npm run test:e2e:smoke
 * (requires the app to already be running, e.g. via the "Start application"
 * workflow / `npm run dev`, on the URL configured by SMOKE_BASE_URL or the
 * default http://localhost:5000)
 */

test.describe('primary journey smoke test', () => {
  test('landing -> registration -> live password strength feedback', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const unexpectedResponses: string[] = [];
    let expectedUnauthenticatedUserProbes = 0;
    const isExpectedAnalyticsRequest = (url: string) => {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname === 'www.googletagmanager.com' && parsedUrl.pathname === '/gtag/js';
    };
    const isExpectedPreviewHmrError = (message: string) =>
      /^WebSocket connection to 'wss:\/\/[^']+:24678\/\?token=[^']+' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED$/.test(message) ||
      message === '[vite] failed to connect to websocket (Error: WebSocket closed without opened.). ';

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    page.on('requestfailed', (request) => {
      if (isExpectedAnalyticsRequest(request.url())) return;
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/api/user' && request.failure()?.errorText === 'net::ERR_ABORTED') return;
      failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'unknown failure'}`);
    });
    page.on('response', (response) => {
      if (response.status() < 400) return;
      const pathname = new URL(response.url()).pathname;
      if (pathname === '/api/user' && response.status() === 401) {
        expectedUnauthenticatedUserProbes += 1;
        return;
      }
      unexpectedResponses.push(`${response.status()} ${response.url()}`);
    });

    // 1. Landing: an unauthenticated visitor lands on the marketing/auth
    // screen (root is a protected route and redirects here).
    await page.goto('/');
    await expect(page).toHaveURL(/\/auth/);
    await expect(page.getByText('Referral', { exact: true }).first()).toBeVisible();

    // 2. Navigate into the registration flow.
    const createAccount = page.getByRole('button', { name: /create account/i }).first();
    await createAccount.click();
    await expect(page).toHaveURL(/\/auth\/register/);
    await expect(page.getByTestId('input-email')).toBeVisible();

    // 3. One core action: typing a weak password shows the live strength
    // checklist; strengthening it clears the failing requirements. No form
    // submission occurs, so no request ever reaches Firebase.
    const passwordInput = page.getByTestId('input-password');
    await passwordInput.fill('weak');
    await expect(page.getByText('At least 8 characters')).toBeVisible();

    await passwordInput.fill('StrongPass1!');
    await expect(page.getByText('At least 8 characters')).toHaveCount(0);

    // The submit button is present but is never clicked - this test stays
    // entirely client-side and touches no production service.
    await expect(page.getByTestId('button-submit')).toBeVisible();

    // The protected user bootstrap intentionally returns 401 before login.
    // All other browser errors are unexpected and fail this gate.
    const expectedResourceErrors = consoleErrors.filter((message) =>
      /^Failed to load resource: the server responded with a status of 401\b/.test(message),
    );
    expect(expectedResourceErrors.length).toBeLessThanOrEqual(expectedUnauthenticatedUserProbes);
    expect(consoleErrors.filter((message) =>
      !expectedResourceErrors.includes(message) && !isExpectedPreviewHmrError(message),
    )).toEqual([]);
    expect(pageErrors.filter((message) => message !== 'WebSocket closed without opened.')).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(unexpectedResponses).toEqual([]);
  });

  test('synthetic authenticated session -> profile on desktop and mobile', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const unexpectedResponses: string[] = [];
    const isExpectedAnalyticsRequest = (url: string) => {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname === 'www.googletagmanager.com' && parsedUrl.pathname === '/gtag/js';
    };

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
      if (isExpectedAnalyticsRequest(request.url())) return;
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/api/user' && request.failure()?.errorText === 'net::ERR_ABORTED') return;
      failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'unknown failure'}`);
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        unexpectedResponses.push(`${response.status()} ${response.url()}`);
      }
    });

    // The server exposes this endpoint only when SMOKE_TEST=true. It creates
    // a disposable HttpOnly fixture cookie and never contacts Firebase or
    // production data services. The CI smoke build also skips Firebase init.
    const smokeSession = await page.request.get('/__smoke/session');
    test.skip(smokeSession.status() !== 200, 'Synthetic authenticated browser fixture is CI-only');
    await page.goto('/__smoke/session');
    await expect(page).toHaveURL(/__smoke\/session/);

    await page.goto('/profile');
    await expect(page).toHaveURL(/\/profile/);
    await expect(page.getByText('CI Smoke User', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /preview/i }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(unexpectedResponses).toEqual([]);
  });

  test('representative authenticated routes pass the accessibility smoke checks', async ({ page }) => {
    // The fixture session is deliberately synthetic. API responses are
    // reduced to empty collections so this check exercises each route's real
    // rendered controls without depending on production data.
    const smokeSession = await page.request.get('/__smoke/session');
    test.skip(smokeSession.status() !== 200, 'Synthetic authenticated browser fixture is CI-only');
    await page.goto('/__smoke/session');
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/user') {
        await route.continue();
        return;
      }
      if (url.pathname === '/api/notifications/counts') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ messages: 0, connectionRequests: 0, newConnections: 0 }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    for (const route of [
      '/auth/register',
      '/profile',
      '/network',
      '/network/search',
      '/connections',
      '/settings',
    ]) {
      await page.goto(route);
      await page.waitForTimeout(150);
      const violations = await page.evaluate(() => {
        const failures: string[] = [];
        const visible = (element: Element) => {
          const style = window.getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            (element as HTMLElement).offsetParent !== null;
        };
        const accessibleName = (element: Element) => {
          const labelledBy = element.getAttribute('aria-labelledby');
          if (labelledBy) {
            return labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
          }
          return element.getAttribute('aria-label') ||
            element.getAttribute('title') ||
            (element as HTMLInputElement).labels?.[0]?.textContent?.trim() ||
            element.textContent?.trim() ||
            '';
        };

        const ids = new Set<string>();
        document.querySelectorAll('[id]').forEach((element) => {
          const id = element.id;
          if (ids.has(id)) failures.push(`duplicate id: ${id}`);
          ids.add(id);
        });
        document.querySelectorAll('img').forEach((element) => {
          if (visible(element) && !element.hasAttribute('alt')) failures.push('image missing alt');
        });
        document.querySelectorAll('button, a, input, select, textarea, [role="button"]').forEach((element) => {
          if (visible(element) && !accessibleName(element)) {
            failures.push(`${element.tagName.toLowerCase()} missing accessible name`);
          }
        });
        document.querySelectorAll('input, select, textarea').forEach((element) => {
          if (!visible(element) || element.getAttribute('type') === 'hidden') return;
          if (!element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') &&
            !(element as HTMLInputElement).labels?.length) {
            failures.push(`${element.tagName.toLowerCase()} missing label`);
          }
        });
        return failures;
      });
      expect(violations, `Accessibility violations on ${route}`).toEqual([]);
    }
  });
});
