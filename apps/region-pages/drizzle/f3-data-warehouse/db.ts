import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import { loadEnvConfig } from '@/lib/env';
import { WAREHOUSE_POOL_CONFIG } from '../pool-config';
import { RetryPool } from '../retry-pool';
import * as schema from './schema';

let pool: RetryPool | Pool | null = null;
let connector: InstanceType<
  typeof import('@google-cloud/cloud-sql-connector').Connector
> | null = null;
let dbInstance: NodePgDatabase<typeof schema> | null = null;
let initPromise: Promise<NodePgDatabase<typeof schema>> | null = null;

/**
 * Creates a pool using the Cloud SQL Node.js Connector.
 * Requires: CLOUD_SQL_WAREHOUSE_CONNECTION_NAME, WAREHOUSE_DB_USER, WAREHOUSE_DB_NAME
 */
async function createCloudSqlPool(): Promise<Pool> {
  const { Connector, IpAddressTypes: IpAddressTypesValues } = await import(
    '@google-cloud/cloud-sql-connector'
  );

  const instanceConnectionName =
    process.env.CLOUD_SQL_WAREHOUSE_CONNECTION_NAME;
  const dbUser = process.env.WAREHOUSE_DB_USER;
  const dbPassword = process.env.WAREHOUSE_DB_PASSWORD;
  const dbName = process.env.WAREHOUSE_DB_NAME;

  if (!instanceConnectionName || !dbUser || !dbName) {
    throw new Error(
      'Cloud SQL Connector requires CLOUD_SQL_WAREHOUSE_CONNECTION_NAME, WAREHOUSE_DB_USER, and WAREHOUSE_DB_NAME.'
    );
  }

  const validTypes = Object.values(IpAddressTypesValues) as string[];
  const ipAddressType = validTypes.includes(
    process.env.CLOUD_SQL_WAREHOUSE_IP_TYPE ?? ''
  )
    ? (process.env.CLOUD_SQL_WAREHOUSE_IP_TYPE as IpAddressTypes)
    : IpAddressTypesValues.PUBLIC;

  connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName,
    ipType: ipAddressType,
  });

  const newPool = new Pool({
    ...clientOpts,
    ...WAREHOUSE_POOL_CONFIG,
    user: dbUser,
    password: dbPassword,
    database: dbName,
  });

  newPool.on('error', (err) => {
    console.error('[warehouse] idle client error:', err.message);
  });

  console.log(
    `[warehouse] pool initialized via Cloud SQL Connector (${instanceConnectionName})`
  );
  return newPool;
}

/**
 * Creates a RetryPool using a direct TCP connection via F3_DATA_WAREHOUSE_URL.
 * Includes automatic retry on transient errors (ETIMEDOUT, ECONNRESET, etc).
 */
function createDirectPool(): RetryPool {
  const { F3_DATA_WAREHOUSE_URL } = loadEnvConfig();

  return new RetryPool({
    connectionString: F3_DATA_WAREHOUSE_URL,
    ...WAREHOUSE_POOL_CONFIG,
    maxRetries: 3,
    retryBaseDelayMs: 2_000,
    retryMaxDelayMs: 15_000,
  });
}

/**
 * Returns a cached Drizzle database instance for the F3 Data Warehouse.
 *
 * Connection mode is controlled by WAREHOUSE_DB_CONNECTION_MODE:
 *   "connector" -> Cloud SQL Node.js Connector (authenticated, no public IP needed)
 *   "direct"    -> F3_DATA_WAREHOUSE_URL TCP connection with RetryPool (default)
 */
export async function getDb(): Promise<NodePgDatabase<typeof schema>> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const mode = process.env.WAREHOUSE_DB_CONNECTION_MODE ?? 'direct';

    if (mode === 'connector') {
      pool = await createCloudSqlPool();
    } else {
      pool = createDirectPool();
    }

    dbInstance = drizzle(pool, { schema });
    console.log(`[warehouse] connection mode: ${mode}`);
    return dbInstance;
  })();

  return initPromise;
}

export async function getPool(): Promise<RetryPool | Pool> {
  if (!pool) await getDb();
  return pool!;
}

export async function close(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (connector) {
    connector.close();
    connector = null;
  }
  dbInstance = null;
  initPromise = null;
}
