// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../error-boundary';

function Bomb(): JSX.Element {
  throw new Error('kaboom: something exploded');
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  localStorage.clear();
  // React logs the caught error to console.error; keep test output clean
  // without hiding a real assertion failure.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('root ErrorBoundary renders a safe fallback on a child error', () => {
  it('shows the fallback heading instead of crashing the app', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByText('Oops! Something Went Wrong')).toBeInTheDocument();
    expect(screen.getByTestId('button-error-retry')).toBeInTheDocument();
    expect(screen.getByTestId('button-error-home')).toBeInTheDocument();
  });

  it('does not render a raw stack trace in production mode', () => {
    process.env.NODE_ENV = 'production';

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByText('Oops! Something Went Wrong')).toBeInTheDocument();
    expect(screen.queryByText(/kaboom: something exploded/)).not.toBeInTheDocument();
    // No raw stack-frame text (e.g. "at Bomb (") should leak into the DOM.
    expect(document.body.textContent).not.toMatch(/at \S+ \(/);
  });

  it('does show diagnostic detail in development mode (sanity check for the test itself)', () => {
    process.env.NODE_ENV = 'development';

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByText(/kaboom: something exploded/)).toBeInTheDocument();
  });

  it('resets back to children when "Try Again" is clicked after the error state is cleared', () => {
    let shouldThrow = true;
    function Flaky(): JSX.Element {
      if (shouldThrow) {
        throw new Error('flaky failure');
      }
      return <div>Recovered content</div>;
    }

    const onReset = vi.fn(() => {
      shouldThrow = false;
    });

    const { rerender } = render(
      <ErrorBoundary onReset={onReset}>
        <Flaky />
      </ErrorBoundary>
    );

    expect(screen.getByText('Oops! Something Went Wrong')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('button-error-retry'));
    expect(onReset).toHaveBeenCalledTimes(1);

    rerender(
      <ErrorBoundary onReset={onReset}>
        <Flaky />
      </ErrorBoundary>
    );

    expect(screen.getByText('Recovered content')).toBeInTheDocument();
  });
});
