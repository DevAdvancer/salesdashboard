/**
 * Backfill script for stats collections
 * Run: bun run backfill:stats:dry
 * Run: bun run backfill:stats
 */

import { aggregateLinkedinStatsForDates, aggregateAgentStatsForDates } from "../lib/server/stats-aggregator";
import { format, subDays } from "date-fns";

const isDryRun = process.argv.includes(":dry") || process.argv.includes("--dry") || process.argv.includes("backfill:stats:dry");

async function run() {
  console.log(`Starting backfill... (Dry run: ${isDryRun})`);
  
  if (isDryRun) {
    console.log("Dry run mode: Would aggregate last 90 days of stats.");
    return;
  }

  const dateKeys = [];
  const today = new Date();
  for (let i = 0; i < 90; i++) {
    dateKeys.push(format(subDays(today, i), "yyyy-MM-dd"));
  }

  console.log(`Aggregating stats for ${dateKeys.length} days...`);
  
  await aggregateLinkedinStatsForDates(dateKeys);
  console.log("LinkedIn stats aggregated.");
  
  await aggregateAgentStatsForDates(dateKeys);
  console.log("Agent stats aggregated.");

  console.log("Backfill complete!");
}

run().catch(console.error);
