/**
 * Run this seed with:
 * pnpm -F db seed ./src/seed/core.ts
 */
import { insertDatabaseStructure } from "../seed";

const main = async () => {
  await insertDatabaseStructure();
};

void main();
