import { describe, expect, test } from "vitest";
import { parseWorkflowCli, validateWorkflowText } from "./validate-workflows.mjs";

describe("GitHub Actions workflow validation", () => {
  test("rejects duplicate YAML keys before an overlay can be published", () => {
    const workflow = `
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    timeout-minutes: 20
    steps:
      - run: npm test
`;
    expect(() => validateWorkflowText(workflow, "public-overlay")).toThrow(/keys must be unique/i);
  });

  test("accepts the corrected workflow fixture shape", () => {
    expect(() => validateWorkflowText(`
name: CI
on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`, "valid.yml")).not.toThrow();
  });

  test("rejects malformed workflow structure", () => {
    expect(() => validateWorkflowText(`
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
`, "missing-steps.yml")).toThrow(/must define "steps"/i);
  });

  test("rejects unbalanced Actions expressions", () => {
    expect(() => validateWorkflowText(`
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ github.sha }"
`, "expression.yml")).toThrow(/unbalanced/i);
  });

  test("resolves explicit workflow roots without changing the process working directory", () => {
    expect(parseWorkflowCli([
      "--workflow-root", "/tmp/canonical",
      ".github/workflows",
      "--overlay-root", "/tmp/public-overlays",
    ])).toEqual({
      workflowRoot: "/tmp/canonical",
      paths: ["/tmp/canonical/.github/workflows", "/tmp/public-overlays"],
    });
  });

  test("keeps the historical default when no explicit paths are supplied", () => {
    expect(parseWorkflowCli([], "/tmp/checkout")).toEqual({
      workflowRoot: "/tmp/checkout",
      paths: ["/tmp/checkout/.github/workflows"],
    });
  });
});