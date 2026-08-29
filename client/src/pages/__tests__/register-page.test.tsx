// @vitest-environment jsdom
//
// Regression coverage for two task #59/#60 fixes bundled in RegisterPage:
//  1. All three `useState` hooks are declared unconditionally, before any
//     early return, so toggling `emailVerificationSent` never changes the
//     number/order of hooks React sees between renders (a "different hook
//     count" render error would previously occur, or React would warn).
//  2. The post-registration "check verification" redirect never puts an
//     email, uid, or token into the URL or into `window.location.href`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// vi.mock factories run during hoisted module evaluation - before any plain
// top-level `const` in this file is initialized - so shared fixtures used
// inside factories must themselves be created via vi.hoisted().
const { mutateAsync, setLocation, toastSpy, mockCurrentUser } = vi.hoisted(() => ({
  mutateAsync: vi.fn().mockResolvedValue({ id: 1 }),
  setLocation: vi.fn(),
  toastSpy: vi.fn(),
  mockCurrentUser: { email: 'form-user@example.com', uid: 'firebase-uid-abc123' },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: null,
    registerMutation: { mutateAsync, isPending: false },
  }),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/register', setLocation],
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect">redirect:{to}</div>,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock('../../lib/firebase', () => ({
  auth: { currentUser: mockCurrentUser },
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  logoutUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false },
}));
vi.mock('@capacitor/keyboard', () => ({
  Keyboard: { hide: vi.fn().mockResolvedValue(undefined) },
}));

import RegisterPage from '../register-page';

// Track every value ever assigned to window.location.href so we can assert
// no sensitive identifier (email/uid/token) was ever placed in it.
let hrefAssignments: string[] = [];

beforeEach(() => {
  hrefAssignments = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  // jsdom's real Location setter tries to navigate (which it doesn't
  // support) and does a brand check that rejects plain objects, so accessor
  // properties must be defined directly on the stand-in via
  // defineProperty (Object.assign would just evaluate+copy a value and fall
  // through to the inherited native setter).
  const fakeLocation = Object.create(window.location);
  Object.defineProperty(fakeLocation, 'href', {
    configurable: true,
    get() {
      return 'http://localhost/register';
    },
    set(value: string) {
      hrefAssignments.push(value);
    },
  });
  Object.defineProperty(fakeLocation, 'pathname', {
    configurable: true,
    value: '/register',
  });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: fakeLocation,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('RegisterPage hook-order safety across the emailVerificationSent transition', () => {
  it('renders the form, then the verification-sent screen, without a hook-order React warning', async () => {
    render(<RegisterPage />);

    // Initial render: the registration form.
    expect(screen.getByTestId('button-submit')).toBeInTheDocument();

    await fireEvent.change(screen.getByTestId('input-email'), {
      target: { value: 'form-user@example.com' },
    });
    await fireEvent.change(screen.getByTestId('input-password'), {
      target: { value: 'Sup3r$ecret!' },
    });
    await fireEvent.change(screen.getByTestId('input-confirm-password'), {
      target: { value: 'Sup3r$ecret!' },
    });

    const form = screen.getByTestId('button-submit').closest('form')!;
    await fireEvent.submit(form);

    // Transition to the "verification sent" screen happens once the
    // registration mutation resolves.
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Email Verification')).toBeInTheDocument());

    // The critical regression check: React never warned/errored about a
    // different number of hooks being rendered between the form view and
    // the verification-sent view.
    const consoleErrorCalls = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    const hookOrderWarning = consoleErrorCalls.find((msg: string) =>
      /change in the order of Hooks|Rendered (more|fewer) hooks/i.test(msg)
    );
    expect(hookOrderWarning).toBeUndefined();
  });
});

describe('sensitive-redirect flow: no email/uid/token ever appears in a generated URL', () => {
  it('redirects to /verify-email with no query parameters when checking verification status', async () => {
    render(<RegisterPage />);

    await fireEvent.change(screen.getByTestId('input-email'), {
      target: { value: 'form-user@example.com' },
    });
    await fireEvent.change(screen.getByTestId('input-password'), {
      target: { value: 'Sup3r$ecret!' },
    });
    await fireEvent.change(screen.getByTestId('input-confirm-password'), {
      target: { value: 'Sup3r$ecret!' },
    });
    await fireEvent.submit(screen.getByTestId('button-submit').closest('form')!);

    await waitFor(() => expect(screen.getByText('Email Verification')).toBeInTheDocument());

    // "Check verification status" button drives the redirect under test
    // (scoped to the button role - the same phrase also appears in body copy).
    fireEvent.click(screen.getByRole('button', { name: /Check verification status/i }));

    // The handler schedules the actual navigation via a real setTimeout
    // (500ms in the component); wait for it to fire rather than faking
    // timers, since fake timers deadlock with testing-library's waitFor.
    await waitFor(() => expect(hrefAssignments.length).toBeGreaterThan(0), { timeout: 3000 });
    for (const href of hrefAssignments) {
      expect(href).toBe('/verify-email');
      expect(href).not.toContain(mockCurrentUser.email);
      expect(href).not.toContain(mockCurrentUser.uid);
      expect(href).not.toMatch(/[?&](email|uid|token)=/i);
    }
  });
});
