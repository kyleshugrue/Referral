#!/usr/bin/env node

/**
 * Validate GitHub Actions workflow YAML before it can reach a public staging
 * branch. YAML.parseDocument is configured to reject duplicate mapping keys;
 * the structural checks below cover the portable subset of the Actions
 * workflow contract that can be validated without a GitHub runner.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const WORKFLOW_EXTENSIONS = new Set([".yml", ".yaml"]);
const EXPRESSION_PATTERN = /\$\{\{[\s\S]*?\}\}/g;

const fail = (message) => {
  throw new Error(message);
};

const scalarValue = (node) => {
  if (!node) return undefined;
  return typeof node.toJSON === "function" ? node.toJSON() : node;
};

const mappingValue = (mapping, key) => {
  if (!mapping?.items) return undefined;
  const pair = mapping.items.find((item) => scalarValue(item.key) === key);
  return pair?.value;
};

const assertMapping = (node, label) => {
  if (!node || node.constructor?.name !== "YAMLMap") fail(`${label} must be a YAML mapping.`);
  return node;
};

const assertSequence = (node, label) => {
  if (!node || node.constructor?.name !== "YAMLSeq") fail(`${label} must be a YAML sequence.`);
  return node;
};

const assertString = (node, label) => {
  if (typeof scalarValue(node) !== "string") fail(`${label} must be a string.`);
};

const walkScalars = (node, visit) => {
  if (!node) return;
  if (node.constructor?.name === "Scalar") {
    visit(String(scalarValue(node)));
    return;
  }
  for (const item of node.items ?? []) {
    if (node.constructor?.name === "YAMLMap") {
      walkScalars(item.key, visit);
      walkScalars(item.value, visit);
    } else {
      walkScalars(item, visit);
    }
  }
};

const validateExpressions = (document, filePath) => {
  walkScalars(document.contents, (value) => {
    const opens = (value.match(/\$\{\{/g) ?? []).length;
    const closes = (value.match(/\}\}/g) ?? []).length;
    if (opens !== closes) {
      fail(`${filePath}: unbalanced GitHub Actions expression delimiters.`);
    }
    for (const match of value.matchAll(EXPRESSION_PATTERN)) {
      const expression = match[0].slice(3, -2).trim();
      if (!expression) fail(`${filePath}: empty GitHub Actions expression.`);
    }
  });
};

const validateStep = (step, label) => {
  assertMapping(step, label);
  const uses = mappingValue(step, "uses");
  const run = mappingValue(step, "run");
  if (uses === undefined && run === undefined) {
    fail(`${label} must define either "uses" or "run".`);
  }
  if (uses !== undefined) assertString(uses, `${label}.uses`);
  if (run !== undefined) assertString(run, `${label}.run`);
  const withValue = mappingValue(step, "with");
  if (withValue !== undefined) assertMapping(withValue, `${label}.with`);
  const envValue = mappingValue(step, "env");
  if (envValue !== undefined) assertMapping(envValue, `${label}.env`);
};

const validateJob = (job, jobId, filePath) => {
  const label = `${filePath}: jobs.${jobId}`;
  assertMapping(job, label);
  const uses = mappingValue(job, "uses");
  const steps = mappingValue(job, "steps");
  if (uses !== undefined) {
    assertString(uses, `${label}.uses`);
    if (steps !== undefined) fail(`${label} cannot define both "uses" and "steps".`);
    return;
  }
  if (steps === undefined) fail(`${label} must define "steps" or reusable-workflow "uses".`);
  for (const [index, step] of assertSequence(steps, `${label}.steps`).items.entries()) {
    validateStep(step, `${label}.steps[${index}]`);
  }
};

export const validateWorkflowText = (text, filePath = "<workflow>") => {
  const document = YAML.parseDocument(text, {
    prettyErrors: true,
    uniqueKeys: true,
    version: "1.2",
  });
  if (document.errors.length > 0) {
    fail(`${filePath}: ${document.errors.map((error) => error.message).join(" ")}`);
  }
  const root = assertMapping(document.contents, filePath);
  assertString(mappingValue(root, "name"), `${filePath}: name`);
  if (mappingValue(root, "on") === undefined) fail(`${filePath}: missing "on" trigger.`);
  const jobs = assertMapping(mappingValue(root, "jobs"), `${filePath}: jobs`);
  if (jobs.items.length === 0) fail(`${filePath}: jobs must not be empty.`);
  for (const pair of jobs.items) {
    const jobId = scalarValue(pair.key);
    if (typeof jobId !== "string" || !/^[A-Za-z0-9_-]+$/.test(jobId)) {
      fail(`${filePath}: invalid job identifier.`);
    }
    validateJob(pair.value, jobId, filePath);
  }
  validateExpressions(document, filePath);
  return { filePath, jobCount: jobs.items.length };
};

const collectWorkflowFiles = async (inputPath) => {
  const info = await stat(inputPath);
  if (info.isFile()) {
    if (!WORKFLOW_EXTENSIONS.has(path.extname(inputPath).toLowerCase())) return [];
    return [inputPath];
  }
  if (!info.isDirectory()) fail(`${inputPath}: expected a file or directory.`);
  const entries = await readdir(inputPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith(".git"))
      .map((entry) => collectWorkflowFiles(path.join(inputPath, entry.name))),
  );
  return nested.flat();
};

export const validateWorkflowPaths = async (paths) => {
  const files = [...new Set((await Promise.all(paths.map(collectWorkflowFiles))).flat())].sort();
  if (files.length === 0) fail("No workflow YAML files were found.");
  const results = [];
  for (const filePath of files) {
    results.push(validateWorkflowText(await readFile(filePath, "utf8"), filePath));
  }
  return results;
};

export const parseWorkflowCli = (argv, cwd = process.cwd()) => {
  let workflowRoot = cwd;
  const overlayRoots = [];
  const paths = [];

  const nextValue = (index, option) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${option} requires a path.`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--workflow-root") {
      workflowRoot = nextValue(index, argument);
      index += 1;
    } else if (argument.startsWith("--workflow-root=")) {
      workflowRoot = argument.slice("--workflow-root=".length);
    } else if (argument === "--overlay-root") {
      overlayRoots.push(nextValue(index, argument));
      index += 1;
    } else if (argument.startsWith("--overlay-root=")) {
      overlayRoots.push(argument.slice("--overlay-root=".length));
    } else if (argument.startsWith("--")) {
      fail(`Unsupported workflow validation option: ${argument}`);
    } else {
      paths.push(argument);
    }
  }

  const resolvedRoot = path.resolve(workflowRoot);
  const resolvedPaths = paths.length > 0
    ? paths.map((value) => path.resolve(resolvedRoot, value))
    : [path.join(resolvedRoot, ".github", "workflows")];

  return {
    workflowRoot: resolvedRoot,
    paths: [...resolvedPaths, ...overlayRoots.map((value) => path.resolve(value))],
  };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { paths } = parseWorkflowCli(process.argv.slice(2));
  try {
    const results = await validateWorkflowPaths(paths);
    console.log(`Workflow validation passed: ${results.length} file(s), ${results.reduce((sum, result) => sum + result.jobCount, 0)} job(s).`);
  } catch (error) {
    console.error(`Workflow validation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}