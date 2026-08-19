import { NextResponse } from 'next/server';
import { getAuthenticatedAccount } from '@/lib/server/current-user';
import { createAdminClient } from '@/lib/server/appwrite';
import { createNotificationRecord } from '@/lib/server/notifications';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const account = await getAuthenticatedAccount();
    if (!account) {
      return NextResponse.json({ error: 'Unauthorized. Please log in first.' }, { status: 401 });
    }

    const { databases } = await createAdminClient();
    
    // Create the test notification which will also trigger the email
    await createNotificationRecord(databases, {
      recipientId: account.$id,
      type: 'SYSTEM_TEST',
      title: 'Test Notification',
      body: 'This is a test notification to verify that the Vercel live environment is successfully sending emails.',
      targetId: null,
      targetType: null,
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Test notification sent! Check your in-app notifications and your email inbox.' 
    });
  } catch (error: any) {
    console.error('Test notification error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
