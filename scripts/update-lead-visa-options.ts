import dotenv from 'dotenv';
import { Client, Databases } from 'node-appwrite';
import { mkdir, writeFile } from 'node:fs/promises';
import { completeLeadVisaOptions } from '../lib/constants/lead-visa-statuses';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });

async function main() {
  // Import after loading environment variables so collection overrides are honored.
  const { DATABASE_ID, COLLECTIONS } = await import('../lib/constants/appwrite');
  const databases = new Databases(new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!));
  const document = await databases.getDocument(DATABASE_ID, COLLECTIONS.FORM_CONFIG, 'current');
  const fields = JSON.parse(document.fields as string) as { key: string; options?: string[] }[];
  const visaFields = fields.filter((field) => field.key === 'visaStatus');
  if (visaFields.length !== 1) throw new Error('Expected exactly one Visa Status field');
  const before = visaFields[0].options ?? [];
  const after = completeLeadVisaOptions(before);
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run', before, after,
    added: after.filter((option) => !before.includes(option)),
    removed: before.filter((option) => !after.includes(option)) }, null, 2));
  if (!process.argv.includes('--apply') || JSON.stringify(before) === JSON.stringify(after)) return;
  await mkdir('outputs', { recursive: true });
  await writeFile(`outputs/lead-visa-options-${Date.now()}.json`, JSON.stringify(document, null, 2));
  const latest = await databases.getDocument(DATABASE_ID, COLLECTIONS.FORM_CONFIG, 'current');
  if (latest.$updatedAt !== document.$updatedAt) throw new Error('Form changed during preview; rerun');
  visaFields[0].options = after;
  await databases.updateDocument(DATABASE_ID, COLLECTIONS.FORM_CONFIG, 'current', {
    fields: JSON.stringify(fields), version: Number(document.version || 0) + 1,
  });
  const saved = await databases.getDocument(DATABASE_ID, COLLECTIONS.FORM_CONFIG, 'current');
  if (saved.fields !== JSON.stringify(fields)) throw new Error('Saved form verification failed');
  console.log('Saved and verified Visa Status options. All other fields preserved.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Visa options update failed');
  process.exitCode = 1;
});
