// The repository's validation scripts are intentionally JavaScript modules.
// Keep their test-facing surface explicit without weakening the TypeScript
// project itself or pretending that arbitrary modules are type-safe.
declare module '*.mjs' {
  export const ScanError: any;
  export const CLEAN_ROOM_COMMANDS: Array<[string, string[]]>;
  export const applyPolicy: any;
  export const assertCleanSource: any;
  export const assertNoCaseCollisions: any;
  export const assertPublicSubset: any;
  export const assertSafeApplyDatabaseUrl: any;
  export const assertSafeExportRoot: any;
  export const assertStagedPublicPaths: any;
  export const buildCommandEnvironment: any;
  export const buildIntegrityManifest: any;
  export const buildProductionEnvironment: any;
  export const compareRuntimeOutputs: any;
  export const contentTypeFor: any;
  export const exportSelectedFiles: any;
  export const findingFingerprint: any;
  export const getCommittedSnapshot: any;
  export const inspectBinary: (...args: any[]) => Array<Record<string, any>>;
  export const inventoryLegacyUploads: (...args: any[]) => {
    files: Array<Record<string, any>>;
    orphanFiles: Array<Record<string, any>>;
    errors: Array<Record<string, any>>;
  };
  export const localPathForReference: any;
  export const parseCli: any;
  export const scanExport: any;
  export const scanText: (...args: any[]) => Array<Record<string, any>>;
  export const sourceContentTypeFor: any;
  export const trackedPathDigest: any;
  export const validateIntegrityManifest: any;
  export const validateManifest: any;
  export const validatePolicy: any;
  export const validatePublicHygieneAllowlist: any;
  export const validateStagedPublicPaths: any;
  export const validateWorkflowText: any;
  export const verifyMigrationIntegrity: any;
  export const resolveSelection: any;
  export const IndependentScanError: any;
  export const PINNED_TOOLS: any;
  export const execute: any;
  export const normalizeGitleaksReport: any;
  export const normalizeReportPath: any;
  export const normalizeTrufflehogReport: any;
  export const SCANNER_TIMEOUTS: any;
  export const scanThirdPartyExport: (...args: any[]) => Promise<any>;
  export const classifyScannerDiagnostic: any;
  export const TRUFFLEHOG_SCAN_ARGS: any;
  export const validateBinaryPath: any;
  export const validateExportRoot: any;
  export const parseWorkflowCli: any;
  export const parseAheadBehind: any;
  export const classifyChangedPath: any;
  export const evaluateToolchain: any;
  export const compareBaseline: any;
  export const collectSnapshot: any;
  export const findSnapshotIssues: any;
  export const parseStatus: any;
}