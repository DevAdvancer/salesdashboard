import { getTargetReportAction } from "../app/actions/target-report";

async function main() {
  const result = await getTargetReportAction({
    actorId: "admin-user",
    monthKey: "2026-08"
  });

  const prakash = result.result.members.find(m => m.user.name.includes("Prakash"));
  if (prakash) {
    console.log("Prakash Target Report Achieved:", prakash.achieved);
  } else {
    console.log("Prakash not found in target report.");
  }
}

main().catch(console.error);
