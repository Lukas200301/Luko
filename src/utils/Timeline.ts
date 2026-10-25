import { PinboardRange } from '../shared/types';

const DAY = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<PinboardRange, number | null> = { '7d': 7, '30d': 30, '90d': 90, '365d': 365, all: null };

export function rangeStart(range: PinboardRange): number | null {
  const days = RANGE_DAYS[range];
  return days === null ? null : Date.now() - days * DAY;
}

// Groups points into days (7/30 days), weeks (90 days) or months (year / all time), filling gaps with zero.
// `c` is summed per bucket (e.g. reactions); `n` counts the points.
export function buildTimeline(points: { t: number; c: number }[], range: PinboardRange): { label: string; start: number; n: number; sum: number }[] {
  const unit = range === '7d' || range === '30d' ? 'day' : range === '90d' ? 'week' : 'month';

  const startOf = (time: number): Date => {
    const d = new Date(time);
    d.setHours(0, 0, 0, 0);
    if (unit === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    if (unit === 'month') d.setDate(1);
    return d;
  };
  const next = (d: Date): Date => {
    const n = new Date(d);
    if (unit === 'day') n.setDate(n.getDate() + 1);
    else if (unit === 'week') n.setDate(n.getDate() + 7);
    else n.setMonth(n.getMonth() + 1);
    return n;
  };
  const label = (d: Date): string => unit === 'month'
    ? d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const since = rangeStart(range);
  const first = since ?? points[0]?.t;
  if (first === undefined) return [];

  const buckets = new Map<number, { n: number; sum: number }>();
  for (const point of points) {
    const key = startOf(point.t).getTime();
    const bucket = buckets.get(key) ?? { n: 0, sum: 0 };
    bucket.n++;
    bucket.sum += point.c;
    buckets.set(key, bucket);
  }

  const timeline: { label: string; start: number; n: number; sum: number }[] = [];
  for (let d = startOf(first); d.getTime() <= Date.now() && timeline.length < 400; d = next(d)) {
    const bucket = buckets.get(d.getTime()) ?? { n: 0, sum: 0 };
    timeline.push({ label: label(d), start: d.getTime(), ...bucket });
  }
  return timeline;
}
