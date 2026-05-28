"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface FinancialInsightsChartProps {
  data: Array<{
    name: string;
    Total: number;
    Net: number;
  }>;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function FinancialInsightsChart({ data }: FinancialInsightsChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] min-h-[300px] w-full min-w-0 items-center justify-center border border-dashed border-[var(--hairline)] text-sm text-[var(--mute)]">
        No financial data available yet.
      </div>
    );
  }

  return (
    <div className="h-[300px] min-h-[300px] w-full min-w-0">
      <ResponsiveContainer width="100%" height={300} minWidth={0} minHeight={300}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--hairline-soft)"
          />
          <XAxis
            dataKey="name"
            tick={{ fill: "var(--mute)", fontSize: 12 }}
            axisLine={{ stroke: "var(--hairline-soft)" }}
            tickLine={false}
          />
          <YAxis
            width={72}
            tick={{ fill: "var(--mute)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value: number) => {
              if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
              if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
              return `$${value}`;
            }}
          />
          <Tooltip
            formatter={(value) => [currencyFormatter.format(Number(value)), ""]}
            contentStyle={{
              backgroundColor: "var(--canvas)",
              borderColor: "var(--hairline)",
              borderRadius: "0",
              color: "var(--ink)",
              fontSize: "0.875rem",
            }}
            labelStyle={{
              color: "var(--mute)",
              marginBottom: "0.25rem",
            }}
            cursor={{ fill: "rgba(17,17,17,0.04)" }}
          />
          <Legend
            wrapperStyle={{
              fontSize: "0.8125rem",
              color: "var(--mute)",
              paddingTop: "0.5rem",
            }}
          />
          <Bar dataKey="Total" fill="var(--chart-1)" name="Total Deal Value" radius={[0, 0, 0, 0]} />
          <Bar dataKey="Net" fill="var(--chart-2)" name="Net Revenue" radius={[0, 0, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
