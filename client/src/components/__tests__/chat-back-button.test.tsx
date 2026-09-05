// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AlwaysVisibleBackButton } from "../chat-back-button";

const navigate = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/chat/2", navigate],
}));

describe("AlwaysVisibleBackButton", () => {
  afterEach(() => {
    navigate.mockReset();
    vi.useRealTimers();
  });

  it("has an accessible name, keyboard-capable button semantics, and visible focus styling", () => {
    render(<AlwaysVisibleBackButton />);

    const button = screen.getByRole("button", { name: "Back to connections" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass(
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-ring",
    );
    expect(button).toHaveStyle({ width: "36px", height: "36px" });
  });

  it("navigates to connections when activated", () => {
    vi.useFakeTimers();
    render(<AlwaysVisibleBackButton />);

    const button = screen.getByRole("button", { name: "Back to connections" });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    vi.runAllTimers();

    expect(navigate).toHaveBeenCalledWith("/connections");
  });
});