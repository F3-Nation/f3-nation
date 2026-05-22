import { readFileSync } from 'fs';
import { join } from 'path';

describe('seed-workouts configuration', () => {
  const source = readFileSync(join(__dirname, 'seed-workouts.ts'), 'utf-8');

  it('should default UPSERT_CONCURRENCY to 2', () => {
    expect(source).toContain("?? '2'");
    expect(source).not.toContain("?? '8'");
  });
});
