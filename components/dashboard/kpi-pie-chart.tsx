"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

interface KpiPieChartProps {
  completed: number;
  pending: number;
  onSliceClick?: (slice: "complete" | "incomplete") => void;
}

const COLORS = {
  complete: "#10b981", // emerald-500
  incomplete: "#f59e0b", // amber-500
};

export function KpiPieChart({ completed, pending, onSliceClick }: KpiPieChartProps) {
  const data = [
    { name: "Completed", key: "complete" as const, value: completed },
    { name: "Missed", key: "incomplete" as const, value: pending },
  ];
  const total = completed + pending;

  if (total === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
        No members in scope.
      </div>
    );
  }

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            cursor="pointer"
            onClick={(entry) => {
              if (!onSliceClick) return;
              const key = (entry as { key?: "complete" | "incomplete" }).key;
              if (key) onSliceClick(key);
            }}
            label={({ name, value }) => `${name}: ${value}`}
            labelLine={false}
          >
            {data.map((entry) => (
              <Cell key={entry.key} fill={COLORS[entry.key]} />
            ))}
          </Pie>
          <Tooltip
            formatter={((value: number, name: string) => [
              `${value} member${value === 1 ? "" : "s"}`,
              name,
            ]) as never}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
