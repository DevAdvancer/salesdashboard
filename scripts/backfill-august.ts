import { aggregateAgentStatsForDates, aggregateLinkedinStatsForDates } from "../lib/server/stats-aggregator";

async function run() {
  const dates = [];
  for (let i = 1; i <= 31; i++) {
    // We can just generate all of August, it's fine if future dates are empty
    dates.push(`2026-08-${String(i).padStart(2, "0")}`);
  }
  console.log("Backfilling for:", dates);
  await aggregateLinkedinStatsForDates(dates);
  await aggregateAgentStatsForDates(dates);
  console.log("Done");
}

run().catch(console.error);
