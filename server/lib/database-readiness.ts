import { URL } from 'node:url';

export const REQUIRED_SCHEMA_TABLES = [
  'callback_notification_queue',
  'delivery_obligations',
  'account_erasure_jobs',
  'fcm_tokens',
  'match_generation_jobs',
  'session',
  'users',
  'websocket_tickets',
] as const;

export const RATE_LIMIT_SCHEMA_TABLE = 'rate_limit_windows' as const;

export interface RequiredSchemaColumn {
  tableName: string;
  columnName: string;
}

export interface RequiredSchemaIndex {
  tableName: string;
  indexName: string;
}

export interface RequiredSchemaConstraint {
  tableName: string;
  constraintType: 'PRIMARY KEY' | 'UNIQUE' | 'FOREIGN KEY';
  columns: readonly string[];
  referencedTable?: string;
}

interface RequiredSchemaColumnShape extends RequiredSchemaColumn {
  expectedDataType?: string;
  expectedNullable?: 'YES' | 'NO';
  requiresDefault?: boolean;
}

// Keep this contract aligned with the columns selected by storage.getUser and
// the durable recovery queries. Checking information_schema is intentionally
// read-only and catches partial migrations before Passport can deserialize a
// session against an invalid row shape.
export const REQUIRED_SCHEMA_COLUMNS: readonly RequiredSchemaColumn[] = [
  {
    tableName: 'users',
    columnName: 'id',
  },
  {
    tableName: 'users',
    columnName: 'email',
  },
  {
    tableName: 'users',
    columnName: 'full_name',
  },
  {
    tableName: 'users',
    columnName: 'birthday',
  },
  {
    tableName: 'users',
    columnName: 'title',
  },
  {
    tableName: 'users',
    columnName: 'current_location',
  },
  {
    tableName: 'users',
    columnName: 'current_location_lat',
  },
  {
    tableName: 'users',
    columnName: 'current_location_lng',
  },
  {
    tableName: 'users',
    columnName: 'firebase_uid',
  },
  {
    tableName: 'users',
    columnName: 'desired_locations',
  },
  {
    tableName: 'users',
    columnName: 'desired_location_coords',
  },
  {
    tableName: 'users',
    columnName: 'industry',
  },
  {
    tableName: 'users',
    columnName: 'current_company',
  },
  {
    tableName: 'users',
    columnName: 'desired_companies',
  },
  {
    tableName: 'users',
    columnName: 'matching_radius',
  },
  {
    tableName: 'users',
    columnName: 'years_of_experience',
  },
  {
    tableName: 'users',
    columnName: 'bio',
  },
  {
    tableName: 'users',
    columnName: 'photo',
  },
  {
    tableName: 'users',
    columnName: 'resume_url',
  },
  {
    tableName: 'users',
    columnName: 'resume_preview_urls',
  },
  {
    tableName: 'users',
    columnName: 'interests',
  },
  {
    tableName: 'users',
    columnName: 'professional_interests',
  },
  {
    tableName: 'users',
    columnName: 'languages',
  },
  {
    tableName: 'users',
    columnName: 'education_level',
  },
  {
    tableName: 'users',
    columnName: 'institution',
  },
  {
    tableName: 'users',
    columnName: 'profile_visible',
  },
  {
    tableName: 'users',
    columnName: 'email_notifications',
  },
  {
    tableName: 'users',
    columnName: 'read_receipts',
  },
  {
    tableName: 'users',
    columnName: 'email_verification_started',
  },
  {
    tableName: 'users',
    columnName: 'email_verified',
  },
  {
    tableName: 'users',
    columnName: 'registration_completed',
  },
  {
    tableName: 'users',
    columnName: 'has_minimum_match_data',
  },
  {
    tableName: 'users',
    columnName: 'profile_version',
  },
  {
    tableName: 'users',
    columnName: 'current_snapshot_id',
  },
  {
    tableName: 'users',
    columnName: 'initial_match_jobs_queued',
  },
  {
    tableName: 'users',
    columnName: 'initial_match_jobs_queued_at',
  },
  {
    tableName: 'users',
    columnName: 'account_status',
  },
  {
    tableName: 'users',
    columnName: 'deletion_requested_at',
  },
  {
    tableName: 'users',
    columnName: 'deletion_completed_at',
  },
  {
    tableName: 'callback_notification_queue',
    columnName: 'dedupe_key',
  },
  ...[
    'id',
    'user_id',
    'event_type',
    'payload',
    'dedupe_key',
    'expires_at',
    'status',
    'created_at',
    'completed_at',
  ].map((columnName) => ({ tableName: 'delivery_obligations', columnName })),
  ...[
    'id',
    'user_id',
    'status',
    'attempt_count',
    'next_attempt_at',
    'last_error_code',
    'requested_at',
    'started_at',
    'completed_at',
  ].map((columnName) => ({ tableName: 'account_erasure_jobs', columnName })),
] as const;

const REQUIRED_SCHEMA_COLUMN_SHAPES: readonly RequiredSchemaColumnShape[] = [
  { tableName: 'users', columnName: 'account_status', expectedDataType: 'text', expectedNullable: 'NO', requiresDefault: true },
  { tableName: 'users', columnName: 'deletion_requested_at', expectedDataType: 'timestamp with time zone', expectedNullable: 'YES' },
  { tableName: 'users', columnName: 'deletion_completed_at', expectedDataType: 'timestamp with time zone', expectedNullable: 'YES' },
  { tableName: 'callback_notification_queue', columnName: 'dedupe_key', expectedDataType: 'text', expectedNullable: 'YES' },
  { tableName: 'delivery_obligations', columnName: 'id', expectedDataType: 'integer', expectedNullable: 'NO', requiresDefault: true },
  { tableName: 'delivery_obligations', columnName: 'user_id', expectedDataType: 'integer', expectedNullable: 'NO' },
  { tableName: 'delivery_obligations', columnName: 'event_type', expectedDataType: 'text', expectedNullable: 'NO' },
  { tableName: 'delivery_obligations', columnName: 'payload', expectedDataType: 'text', expectedNullable: 'NO' },
  { tableName: 'delivery_obligations', columnName: 'dedupe_key', expectedDataType: 'text', expectedNullable: 'NO' },
  { tableName: 'delivery_obligations', columnName: 'expires_at', expectedDataType: 'timestamp with time zone', expectedNullable: 'NO' },
  { tableName: 'delivery_obligations', columnName: 'status', expectedDataType: 'text', expectedNullable: 'NO', requiresDefault: true },
  { tableName: 'delivery_obligations', columnName: 'created_at', expectedDataType: 'timestamp with time zone', expectedNullable: 'NO', requiresDefault: true },
  { tableName: 'delivery_obligations', columnName: 'completed_at', expectedDataType: 'timestamp with time zone', expectedNullable: 'YES' },
  { tableName: 'account_erasure_jobs', columnName: 'id', expectedDataType: 'integer', expectedNullable: 'NO', requiresDefault: true },
  { tableName: 'account_erasure_jobs', columnName: 'user_id', expectedDataType: 'integer', expectedNullable: 'NO' },
  { tableName: 'account_erasure_jobs', columnName: 'status', expectedDataType: 'text', expectedNullable: 'NO', requiresDefault: true },
  { tableName: 'account_erasure_jobs', columnName: 'attempt_count', expectedDataType: 'integer', expectedNullable: 'NO', requiresDefault: true },
  { tableName: 'account_erasure_jobs', columnName: 'next_attempt_at', expectedDataType: 'timestamp with time zone', expectedNullable: 'NO', requiresDefault: true },
  { tableName: 'account_erasure_jobs', columnName: 'last_error_code', expectedDataType: 'text', expectedNullable: 'YES' },
  { tableName: 'account_erasure_jobs', columnName: 'requested_at', expectedDataType: 'timestamp with time zone', expectedNullable: 'NO', requiresDefault: true },
  { tableName: 'account_erasure_jobs', columnName: 'started_at', expectedDataType: 'timestamp with time zone', expectedNullable: 'YES' },
  { tableName: 'account_erasure_jobs', columnName: 'completed_at', expectedDataType: 'timestamp with time zone', expectedNullable: 'YES' },
];

export const REQUIRED_SCHEMA_INDEXES: readonly RequiredSchemaIndex[] = [
  { tableName: 'callback_notification_queue', indexName: 'callback_notification_queue_dedupe_key_idx' },
  { tableName: 'delivery_obligations', indexName: 'delivery_obligations_pending_idx' },
  { tableName: 'account_erasure_jobs', indexName: 'account_erasure_jobs_user_id_idx' },
  { tableName: 'account_erasure_jobs', indexName: 'account_erasure_jobs_status_attempt_idx' },
];

export const REQUIRED_SCHEMA_CONSTRAINTS: readonly RequiredSchemaConstraint[] = [
  { tableName: 'users', constraintType: 'PRIMARY KEY', columns: ['id'] },
  { tableName: 'delivery_obligations', constraintType: 'PRIMARY KEY', columns: ['id'] },
  { tableName: 'delivery_obligations', constraintType: 'UNIQUE', columns: ['dedupe_key'] },
  { tableName: 'delivery_obligations', constraintType: 'FOREIGN KEY', columns: ['user_id'], referencedTable: 'users' },
  { tableName: 'account_erasure_jobs', constraintType: 'PRIMARY KEY', columns: ['id'] },
];

function requiredSchemaColumnShapes(
  requiredColumns: readonly RequiredSchemaColumn[],
): readonly RequiredSchemaColumnShape[] {
  const requested = new Set(requiredColumns.map(({ tableName, columnName }) => `${tableName}.${columnName}`));
  return REQUIRED_SCHEMA_COLUMN_SHAPES.filter(({ tableName, columnName }) =>
    requested.has(`${tableName}.${columnName}`),
  );
}

export function requiredSchemaTablesForMode(rateLimitMode = process.env.RATE_LIMIT_MODE): readonly string[] {
  return rateLimitMode === 'postgres'
    ? [...REQUIRED_SCHEMA_TABLES, RATE_LIMIT_SCHEMA_TABLE]
    : REQUIRED_SCHEMA_TABLES;
}

export function requiredSchemaColumnsForTables(
  requiredTables: readonly string[] = REQUIRED_SCHEMA_TABLES,
): readonly RequiredSchemaColumn[] {
  const tableSet = new Set(requiredTables);
  return REQUIRED_SCHEMA_COLUMNS.filter(({ tableName }) => tableSet.has(tableName));
}

export function requiredSchemaIndexesForTables(
  requiredTables: readonly string[] = REQUIRED_SCHEMA_TABLES,
): readonly RequiredSchemaIndex[] {
  const tableSet = new Set(requiredTables);
  return REQUIRED_SCHEMA_INDEXES.filter(({ tableName }) => tableSet.has(tableName));
}

export function requiredSchemaConstraintsForTables(
  requiredTables: readonly string[] = REQUIRED_SCHEMA_TABLES,
): readonly RequiredSchemaConstraint[] {
  const tableSet = new Set(requiredTables);
  return REQUIRED_SCHEMA_CONSTRAINTS.filter(({ tableName }) => tableSet.has(tableName));
}

export interface ReadinessQuery {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface DatabaseReadinessResult {
  ready: boolean;
  missingTables: string[];
  missingColumns: string[];
  invalidColumns: string[];
  missingIndexes: string[];
  missingConstraints: string[];
  reason?: 'database-unavailable' | 'schema-incomplete';
}

export function isDisposableDatabaseUrl(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    const hostname = url.hostname.toLowerCase();
    const databaseName = url.pathname.replace(/^\/+/, '').toLowerCase();
    const localHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]' || hostname === 'helium';
    const disposableName = /^(postgres|test|ci|disposable|tmp|scratch)([-_a-z0-9]*)$/.test(databaseName);
    return url.protocol === 'postgres:' && localHost && disposableName;
  } catch {
    return false;
  }
}

export function assertDisposableDatabaseUrl(connectionString: string): void {
  if (!isDisposableDatabaseUrl(connectionString)) {
    throw new Error('Refusing schema-changing operation: DATABASE_URL must point to a disposable local PostgreSQL database.');
  }
}

export async function checkDatabaseReadiness(
  database: ReadinessQuery,
  requiredTables: readonly string[] = REQUIRED_SCHEMA_TABLES,
  requiredColumns: readonly RequiredSchemaColumn[] = REQUIRED_SCHEMA_COLUMNS,
  requiredIndexes: readonly RequiredSchemaIndex[] = requiredSchemaIndexesForTables(requiredTables),
  requiredConstraints: readonly RequiredSchemaConstraint[] = requiredSchemaConstraintsForTables(requiredTables),
): Promise<DatabaseReadinessResult> {
  try {
    await database.query('SELECT 1');
    const result = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [requiredTables],
    );
    const present = new Set(result.rows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((table) => !present.has(table));
    const columnsResult = requiredColumns.length === 0
      ? { rows: [] }
      : await database.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: 'YES' | 'NO';
        column_default: string | null;
      }>(
        `SELECT table_name, column_name
                , data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ANY($1::text[])
            AND column_name = ANY($2::text[])`,
        [
          requiredTables,
          [...new Set(requiredColumns.map(({ columnName }) => columnName))],
        ],
      );
    const presentColumns = new Set(
      columnsResult.rows.map(({ table_name, column_name }) => `${table_name}.${column_name}`),
    );
    const missingColumns = requiredColumns
      .filter(({ tableName, columnName }) => !presentColumns.has(`${tableName}.${columnName}`))
      .map(({ tableName, columnName }) => `${tableName}.${columnName}`);
    const columnMetadata = new Map(
      columnsResult.rows.map((row) => [`${row.table_name}.${row.column_name}`, row]),
    );
    const invalidColumns = requiredSchemaColumnShapes(requiredColumns).flatMap((shape) => {
      const key = `${shape.tableName}.${shape.columnName}`;
      const metadata = columnMetadata.get(key);
      if (!metadata) return [];
      const invalid = [];
      if (shape.expectedDataType && metadata.data_type !== undefined && metadata.data_type !== shape.expectedDataType) {
        invalid.push(`${key}:type`);
      }
      if (shape.expectedNullable && metadata.is_nullable !== undefined && metadata.is_nullable !== shape.expectedNullable) {
        invalid.push(`${key}:nullable`);
      }
      if (shape.requiresDefault && metadata.column_default !== undefined && !metadata.column_default) {
        invalid.push(`${key}:default`);
      }
      return invalid;
    });
    const indexesResult = requiredIndexes.length === 0
      ? { rows: [] }
      : await database.query<{ indexname: string }>(
        `SELECT indexname
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = ANY($1::text[])`,
        [[...new Set(requiredIndexes.map(({ indexName }) => indexName))]],
      );
    const presentIndexes = new Set(indexesResult.rows.map((row) => row.indexname));
    const missingIndexes = requiredIndexes
      .filter(({ indexName }) => !presentIndexes.has(indexName))
      .map(({ indexName }) => indexName);

    const constraintsResult = requiredConstraints.length === 0
      ? { rows: [] }
      : await database.query<{
        table_name: string;
        constraint_type: 'PRIMARY KEY' | 'UNIQUE' | 'FOREIGN KEY';
        column_names: string[];
        foreign_table_name: string | null;
      }>(
        `SELECT tc.table_name::text AS table_name,
                tc.constraint_type::text AS constraint_type,
                array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position) AS column_names,
                CASE WHEN tc.constraint_type::text = 'FOREIGN KEY'
                     THEN MAX(ccu.table_name::text)
                     ELSE NULL
                END AS foreign_table_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_schema = tc.constraint_schema
            AND kcu.constraint_name = tc.constraint_name
            AND kcu.table_name = tc.table_name
      LEFT JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_schema = tc.constraint_schema
            AND ccu.constraint_name = tc.constraint_name
          WHERE tc.constraint_schema = 'public'
            AND tc.table_name = ANY($1::text[])
            AND tc.constraint_type::text = ANY($2::text[])
          GROUP BY tc.table_name, tc.constraint_type, tc.constraint_name`,
        [
          [...new Set(requiredConstraints.map(({ tableName }) => tableName))],
          [...new Set(requiredConstraints.map(({ constraintType }) => constraintType))],
        ],
      );
    const presentConstraints = new Set(
      constraintsResult.rows.map((row) => [
        row.table_name,
        row.constraint_type,
        row.column_names.join(','),
        row.foreign_table_name ?? '',
      ].join('|')),
    );
    const missingConstraints = requiredConstraints
      .filter((constraint) => !presentConstraints.has([
        constraint.tableName,
        constraint.constraintType,
        constraint.columns.join(','),
        constraint.referencedTable ?? '',
      ].join('|')))
      .map(({ tableName, constraintType, columns }) => `${tableName}:${constraintType}:${columns.join(',')}`);

    return missingTables.length === 0 &&
      missingColumns.length === 0 &&
      invalidColumns.length === 0 &&
      missingIndexes.length === 0 &&
      missingConstraints.length === 0
      ? { ready: true, missingTables: [], missingColumns: [], invalidColumns: [], missingIndexes: [], missingConstraints: [] }
      : {
        ready: false,
        missingTables,
        missingColumns,
        invalidColumns,
        missingIndexes,
        missingConstraints,
        reason: 'schema-incomplete',
      };
  } catch {
    return {
      ready: false,
      missingTables: [...requiredTables],
      missingColumns: requiredColumns.map(({ tableName, columnName }) => `${tableName}.${columnName}`),
      invalidColumns: [],
      missingIndexes: requiredIndexes.map(({ indexName }) => indexName),
      missingConstraints: requiredConstraints.map(({ tableName, constraintType, columns }) =>
        `${tableName}:${constraintType}:${columns.join(',')}`),
      reason: 'database-unavailable',
    };
  }
}