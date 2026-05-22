import { NextRequest, NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';

import { db } from '../../../../../drizzle/db';
import { ingestRuns } from '../../../../../drizzle/schema';
import { mean, stddev } from '../../../../../scripts/math-utils';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const token = authHeader?.replace(/^bearer\s+/i, '');

  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = Math.min(
    Math.max(parseInt(limitParam ?? '20', 10) || 20, 1),
    100
  );

  const runs = await db
    .select()
    .from(ingestRuns)
    .orderBy(desc(ingestRuns.id))
    .limit(limit);

  const successRuns = runs.filter((r) => r.status === 'success');
  const seededValues = successRuns
    .map((r) => r.workoutsSeeded)
    .filter((v): v is number => v != null);
  const durationValues = successRuns
    .map((r) => r.durationSec)
    .filter((v): v is number => v != null);
  const skipRates = successRuns
    .map((r) => {
      const seeded = r.workoutsSeeded ?? 0;
      const skipped = r.workoutsSkipped ?? 0;
      const total = seeded + skipped;
      return total > 0 ? skipped / total : null;
    })
    .filter((v): v is number => v != null);

  const p95 = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil(0.95 * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  };

  const summary = {
    totalRuns: runs.length,
    successCount: successRuns.length,
    averageWorkoutsSeeded: Math.round(mean(seededValues)),
    stddevWorkoutsSeeded: Math.round(stddev(seededValues)),
    p95WorkoutsSeeded: p95(seededValues),
    averageDurationSec: Math.round(mean(durationValues)),
    averageSkipRate: parseFloat(mean(skipRates).toFixed(4)),
  };

  return NextResponse.json({ runs, summary });
}
