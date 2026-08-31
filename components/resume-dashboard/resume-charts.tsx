'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import type { ResumeDashboardData } from '@/app/actions/resume-dashboard';
import { Skeleton } from '@/components/ui/skeleton';

interface ResumeChartsProps {
  stageDistribution?: ResumeDashboardData['stageDistribution'];
  loading?: boolean;
}

export function ResumeCharts({ stageDistribution, loading }: ResumeChartsProps) {
  return (
    <Card className="col-span-1 shadow-sm border-slate-200 dark:border-slate-800">
      <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b">
        <CardTitle>Pipeline Distribution</CardTitle>
        <CardDescription>Current snapshot of profile stages</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="h-[300px] w-full">
          {loading || !stageDistribution ? (
            <Skeleton className="h-full w-full" />
          ) : stageDistribution.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              No active profiles found
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stageDistribution}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  label={({ name, percent }: any) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
                >
                  {stageDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: any, name: any) => [value, name]} 
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                />
                <Legend iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
