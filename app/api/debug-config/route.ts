import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    endpoint: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
    projectId: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID,
    databaseId: process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID,
    collections: {
      users: process.env.NEXT_PUBLIC_APPWRITE_USERS_COLLECTION_ID,
      leads: process.env.NEXT_PUBLIC_APPWRITE_LEADS_COLLECTION_ID,
      formConfig: process.env.NEXT_PUBLIC_APPWRITE_FORM_CONFIG_COLLECTION_ID,
      accessConfig: process.env.NEXT_PUBLIC_APPWRITE_ACCESS_CONFIG_COLLECTION_ID,
    },
  });
}
