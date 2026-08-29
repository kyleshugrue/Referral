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
      message === 'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
    );
    expect(expectedResourceErrors.length).toBeLessThanOrEqual(expectedUnauthenticatedUserProbes);
    expect(consoleErrors.filter((message) => !expectedResourceErrors.includes(message))).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(unexpectedResponses).toEqual([]);
  });
});
