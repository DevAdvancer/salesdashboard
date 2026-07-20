require('dotenv').config({ path: '.env' });
const sdk = require('node-appwrite');

async function run() {
  const client = new sdk.Client();
  client
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new sdk.Databases(client);
  const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID;
  const collectionId = 'previous_followups_payments';

  try {
    console.log('Adding createdById attribute...');
    await databases.createStringAttribute(
      databaseId,
      collectionId,
      'createdById',
      255,
      false
    );
    console.log('Successfully created createdById');
  } catch (err) {
    if (err.code === 409) {
      console.log('createdById already exists.');
    } else {
      console.error('Error creating createdById:', err);
    }
  }

  try {
    console.log('Adding createdByName attribute...');
    await databases.createStringAttribute(
      databaseId,
      collectionId,
      'createdByName',
      255,
      false
    );
    console.log('Successfully created createdByName');
  } catch (err) {
    if (err.code === 409) {
      console.log('createdByName already exists.');
    } else {
      console.error('Error creating createdByName:', err);
    }
  }
}

run();
