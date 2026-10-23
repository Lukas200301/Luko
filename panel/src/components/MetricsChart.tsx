import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { formatTime } from '../lib/utils';
import type { MetricSample } from '../lib/types';
import { Card, CardBody, CardHeader, EmptyState, Tabs } from './ui';

type Range = '1h' | '6h' | '24h';
type Metric = 'memory' | 'ping' | 'cpu';

const RANGE_MS: Record<Range, number> = { '1h': 3600_000, '6h': 6 * 3600_000, '24h': 24 * 3600_000 };

export function MetricsChart() {
  const [range, setRange] = useState<Range>('1h');
  const [metric, setMetric] = useState<Metric>('memory');
  const { data: samples = [] } = useQuery({
    queryKey: ['metrics'],
    queryFn: () => api.get<MetricSample[]>('/api/metrics'),
    refetchInterval: 60_000
  });

  const data = useMemo(() => {
    const since = Date.now() - RANGE_MS[range];
    return samples.filter(s => s.t >= since).map(s => ({
      t: s.t,
      value: metric === 'memory' ? Math.round(s.memoryRss / 1024 / 1024) : metric === 'ping' ? s.ping : s.cpuPercent
    }));
  }, [samples, range, metric]);

  const unit = metric === 'memory' ? 'MB' : metric === 'ping' ? 'ms' : '%';

  return (
    <Card>
      <CardHeader
        title="Performance"
        description="Sampled every minute while the bot is running"
        icon={<Activity className="size-4" />}
        actions={
          <>
            <Tabs value={metric} onChange={setMetric} tabs={[{ value: 'memory', label: 'Memory' }, { value: 'ping', label: 'Ping' }, { value: 'cpu', label: 'CPU' }]} />
            <Tabs value={range} onChange={setRange} tabs={[{ value: '1h', label: '1h' }, { value: '6h', label: '6h' }, { value: '24h', label: '24h' }]} />
          </>
        }
      />
      <CardBody className="h-64">
        {data.length < 2 ? (
          <EmptyState icon={<Clock className="size-5" />} title="Collecting data" description="The first data points appear a couple of minutes after the bot starts." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="metricFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                stroke="var(--muted)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} unit={unit === '%' ? '%' : ''} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--muted)' }}
                labelFormatter={(t) => formatTime(Number(t))}
                formatter={(v) => [`${v} ${unit}`, metric === 'memory' ? 'Memory' : metric === 'ping' ? 'Ping' : 'CPU']}
              />
              <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} fill="url(#metricFill)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardBody>
    </Card>
  );
}
