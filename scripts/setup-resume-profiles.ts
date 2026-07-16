/**
 * Standalone setup script for Resume Profiles collection.
 * Run: npx tsx scripts/setup-resume-profiles.ts
 */
import { Client, Databases } from 'node-appwrite';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { DATABASE_ID, COLLECTIONS } from '../lib/constants/appwrite';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;

if (!PROJECT_ID || !API_KEY) {
  console.error('Missing Project ID or API Key in environment variables.');
  process.exit(1);
}

const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const databases = new Databases(client);

const collectionId = COLLECTIONS.RESUME_PROFILES;
const collectionName = 'Resume Profiles';

async function setup() {
  console.log(`Setting up collection: ${collectionName} (${collectionId})...`);

  // If collection exists and we need to recreate due to previous attribute limit errors
  const shouldReset = process.argv.includes('--reset');
  if (shouldReset) {
    try {
      await databases.deleteCollection(DATABASE_ID, collectionId);
      console.log(`Deleted existing collection ${collectionId} for clean recreation.`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (e: any) {
      if (Number(e?.code) !== 404) {
        console.warn(`Could not delete collection: ${e.message}`);
      }
    }
  }

  // 1. Create collection if not exists
  try {
    await databases.getCollection(DATABASE_ID, collectionId);
    console.log(`Collection ${collectionId} already exists.`);
  } catch (error: any) {
    if (Number(error?.code) === 404) {
      console.log(`Creating collection ${collectionId}...`);
      await databases.createCollection(
        DATABASE_ID,
        collectionId,
        collectionName
      );
      console.log(`Collection ${collectionId} created successfully.`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } else {
      throw error;
    }
  }

  // 2. Attributes (budgeted total ~13,500 chars to stay safely inside Appwrite/MySQL 65535 byte row limit)
  const attributes = [
    { key: 'callRequestId', type: 'string', required: false, size: 255 },
    { key: 'leadId', type: 'string', required: false, size: 255 },
    { key: 'candidateName', type: 'string', required: true, size: 255 },
    { key: 'technology', type: 'string', required: false, size: 255 },
    { key: 'usaArrival', type: 'string', required: false, size: 255 },
    { key: 'bachelors', type: 'string', required: false, size: 255 },
    { key: 'masters', type: 'string', required: false, size: 255 },
    { key: 'cpt', type: 'string', required: false, size: 20 },
    { key: 'cptDetails', type: 'string', required: false, size: 1000 },
    { key: 'opt', type: 'string', required: false, size: 20 },
    { key: 'optDetails', type: 'string', required: false, size: 1000 },
    { key: 'stemOpt', type: 'string', required: false, size: 20 },
    { key: 'stemOptDetails', type: 'string', required: false, size: 1000 },
    { key: 'indiaExperience', type: 'string', required: false, size: 2000 },
    { key: 'missingDocs', type: 'string', required: false, size: 1500 },
    { key: 'resumeTimeline', type: 'string', required: false, size: 2500 },
    { key: 'remarks', type: 'string', required: false, size: 2000 },
    { key: 'stage', type: 'string', required: false, size: 255, default: '1. Draft' },
    { key: 'assignedToId', type: 'string', required: false, size: 255 },
    { key: 'assignedToName', type: 'string', required: false, size: 255 },
    { key: 'createdBy', type: 'string', required: false, size: 255 },
    { key: 'createdByName', type: 'string', required: false, size: 255 },
    { key: 'createdAt', type: 'datetime', required: true },
    { key: 'updatedAt', type: 'datetime', required: false },
    { key: 'stageUpdatedAt', type: 'datetime', required: false },
    { key: 'lastAlertStage', type: 'string', required: false, size: 255 },
    { key: 'lastAlertAt', type: 'datetime', required: false },
    // Marketing promotion — analogous to a lead's `isClosed`. Set true by the
    // "Move to Marketing" action once a profile reaches the '4. Marketing'
    // stage; the Resume Marketing page lists only rows where this is true.
    { key: 'movedToMarketing', type: 'boolean', required: false, default: false },
    { key: 'marketingMovedAt', type: 'datetime', required: false },
  ];

  for (const attr of attributes) {
    try {
      await databases.getAttribute(DATABASE_ID, collectionId, attr.key);
      console.log(`Attribute ${attr.key} already exists.`);
    } catch (error: any) {
      if (Number(error?.code) === 404) {
        console.log(`Creating attribute: ${attr.key} (${attr.type})...`);
        if (attr.type === 'string') {
          await databases.createStringAttribute(
            DATABASE_ID,
            collectionId,
            attr.key,
            attr.size || 255,
            attr.required || false,
            attr.default as string
          );
        } else if (attr.type === 'datetime') {
          await databases.createDatetimeAttribute(
            DATABASE_ID,
            collectionId,
            attr.key,
            attr.required || false,
            attr.default as string
          );
        } else if (attr.type === 'boolean') {
          await databases.createBooleanAttribute(
            DATABASE_ID,
            collectionId,
            attr.key,
            attr.required || false,
            attr.default as boolean
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      } else {
        console.error(`Error checking attribute ${attr.key}:`, error.message);
      }
    }
  }

  // Wait before creating indexes
  console.log('Waiting for attributes to settle before checking indexes...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // 3. Indexes
  const indexes = [
    { key: 'stage_idx', attributes: ['stage'] },
    { key: 'assigned_to_idx', attributes: ['assignedToId'] },
    { key: 'call_req_idx', attributes: ['callRequestId'] },
    { key: 'stage_updated_idx', attributes: ['stageUpdatedAt'] },
    // Scoped Marketing page query: filter by movedToMarketing, then narrow
    // to the current agent via assignedToId.
    { key: 'marketing_idx', attributes: ['movedToMarketing', 'assignedToId'] },
  ];

  for (const idx of indexes) {
    try {
      await databases.getIndex(DATABASE_ID, collectionId, idx.key);
      console.log(`Index ${idx.key} already exists.`);
    } catch (error: any) {
      if (Number(error?.code) === 404) {
        console.log(`Creating index: ${idx.key}...`);
        await databases.createIndex(
          DATABASE_ID,
          collectionId,
          idx.key,
          'key',
          idx.attributes
        );
        await new Promise((resolve) => setTimeout(resolve, 800));
      } else {
        console.error(`Error checking index ${idx.key}:`, error.message);
      }
    }
  }

  console.log('Resume Profiles collection setup complete!');
}

setup().catch((e) => {
  console.error('Fatal setup error:', e);
  process.exit(1);
});
