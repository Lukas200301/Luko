import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Bar chart over time (or any labelled buckets). Loaded on demand (recharts is large), like the dashboard's metrics chart.
export function TimelineChart({ data, dataKey, name }: { data: readonly { label: string }[]; dataKey: string; name: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} minTickGap={12} />
        <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: 'var(--surface-2)' }}
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: 'var(--muted)' }}
          formatter={(value) => [value, name]}
        />
        <Bar dataKey={dataKey} fill="var(--accent)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
