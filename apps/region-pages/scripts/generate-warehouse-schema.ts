#!/usr/bin/env tsx

import { execSync } from 'child_process';
import { loadEnvConfig } from '../src/lib/env';

async function generateWarehouseSchema() {
  try {
    // Load environment variables
    const { F3_DATA_WAREHOUSE_URL } = loadEnvConfig();

    if (!F3_DATA_WAREHOUSE_URL) {
      throw new Error(
        'F3_DATA_WAREHOUSE_URL is required for schema generation (set WAREHOUSE_DB_CONNECTION_MODE=direct)'
      );
    }

    console.log('🔍 Generating schema from F3 Data Warehouse...');
    console.log(
      `📊 Database URL: ${F3_DATA_WAREHOUSE_URL.replace(/:[^:@]*@/, ':***@')}`
    );

    // Run drizzle-kit introspect with the warehouse config
    execSync(
      'npx drizzle-kit introspect --config=drizzle.config.warehouse.ts',
      {
        stdio: 'inherit',
        cwd: process.cwd(),
      }
    );

    console.log('✅ Warehouse schema generated successfully!');
    console.log('📁 Schema saved to: drizzle/migrations/warehouse-schema.ts');
  } catch (error) {
    console.error('❌ Error generating warehouse schema:', error);
    process.exit(1);
  }
}

generateWarehouseSchema();
