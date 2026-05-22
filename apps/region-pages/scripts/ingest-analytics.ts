import { desc, eq } from 'drizzle-orm';

import { db } from '../drizzle/db';
import { ingestRuns } from '../drizzle/schema';
import { mean, stddev } from './math-utils';

export type IngestComparison = {
  lastRun: {
    workoutsSeeded: number;
    workoutsSkipped: number;
    regionsSeeded: number;
    durationSec: number;
  } | null;
  deltas: {
    workoutsSeeded: number;
    workoutsSeededPct: number;
    workoutsSkipped: number;
    regionsSeeded: number;
  } | null;
  rolling: {
    mean: number;
    stddev: number;
    window: number;
    sampleSize: number;
  };
  skipRate: number;
  anomaly: {
    flagged: boolean;
    message: string | null;
  };
};

type CurrentStats = {
  workoutsSeeded: number;
  workoutsSkipped: number;
  regionsSeeded: number;
  durationSec: number;
};

export async function getIngestComparison(
  current: CurrentStats,
  windowSize = 10
): Promise<IngestComparison> {
  const recentRuns = await db
    .select({
      workoutsSeeded: ingestRuns.workoutsSeeded,
      workoutsSkipped: ingestRuns.workoutsSkipped,
      regionsSeeded: ingestRuns.regionsSeeded,
      durationSec: ingestRuns.durationSec,
    })
    .from(ingestRuns)
    .where(eq(ingestRuns.status, 'success'))
    .orderBy(desc(ingestRuns.id))
    .limit(windowSize);

  const total = current.workoutsSeeded + current.workoutsSkipped;
  const skipRate = total > 0 ? current.workoutsSkipped / total : 0;

  // Last run is the most recent completed run (first in desc order)
  const lastRun = recentRuns.length > 0 ? recentRuns[0] : null;

  let deltas: IngestComparison['deltas'] = null;
  if (lastRun?.workoutsSeeded != null) {
    const wsDelta = current.workoutsSeeded - lastRun.workoutsSeeded;
    deltas = {
      workoutsSeeded: wsDelta,
      workoutsSeededPct:
        lastRun.workoutsSeeded > 0
          ? (wsDelta / lastRun.workoutsSeeded) * 100
          : 0,
      workoutsSkipped: current.workoutsSkipped - (lastRun.workoutsSkipped ?? 0),
      regionsSeeded: current.regionsSeeded - (lastRun.regionsSeeded ?? 0),
    };
  }

  // Rolling stats from historical runs
  const values = recentRuns
    .map((r) => r.workoutsSeeded)
    .filter((v): v is number => v != null);

  const sampleSize = values.length;
  const rollingMean = mean(values);
  const rollingStddev = stddev(values);

  // Anomaly detection: >2 stddevs from mean (only if we have enough data)
  let flagged = false;
  let message: string | null = null;
  if (sampleSize >= 3 && rollingStddev > 0) {
    const zScore =
      Math.abs(current.workoutsSeeded - rollingMean) / rollingStddev;
    if (zScore > 2) {
      flagged = true;
      const ratio =
        rollingMean > 0
          ? (current.workoutsSeeded / rollingMean).toFixed(1)
          : '?';
      message = `workouts seeded ${current.workoutsSeeded.toLocaleString('en-US')} is ${ratio}x vs ${Math.round(rollingMean).toLocaleString('en-US')} avg (z=${zScore.toFixed(1)})`;
    }
  }

  return {
    lastRun: lastRun
      ? {
          workoutsSeeded: lastRun.workoutsSeeded ?? 0,
          workoutsSkipped: lastRun.workoutsSkipped ?? 0,
          regionsSeeded: lastRun.regionsSeeded ?? 0,
          durationSec: lastRun.durationSec ?? 0,
        }
      : null,
    deltas,
    rolling: {
      mean: rollingMean,
      stddev: rollingStddev,
      window: windowSize,
      sampleSize,
    },
    skipRate,
    anomaly: { flagged, message },
  };
}
