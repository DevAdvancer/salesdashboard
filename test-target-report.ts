
import { getTargetReportAction } from "./app/actions/target-report";

async function main() {
    const res = await getTargetReportAction({ actorId: "669919f2001150c95cd0", monthKey: "2026-08" });
    let alisha = null;
    for (const row of res.result.rows) {
        for (const agent of row.agents) {
            if (agent.userName.toLowerCase().includes("alisha")) {
                alisha = agent;
            }
        }
    }
    console.log(alisha);
}
main().catch(console.error);

