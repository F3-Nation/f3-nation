import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { userRepository, userProfileRepository } from '@/db';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { f3Name, hospitalName } = await request.json();

    if (!f3Name || typeof f3Name !== 'string' || !f3Name.trim()) {
      return NextResponse.json({ error: 'F3 name is required' }, { status: 400 });
    }

    if (!hospitalName || typeof hospitalName !== 'string' || !hospitalName.trim()) {
      return NextResponse.json({ error: 'Hospital name is required' }, { status: 400 });
    }

    // Parse hospital name into first/last name for public.users
    const words = hospitalName.trim().split(/\s+/);
    const lastName = words.pop() || '';
    const firstName = words.join(' ');

    // Update the user's F3 name and first/last name in public.users
    await userRepository.update(session.user.id, {
      f3Name: f3Name.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      updated: new Date(),
    });

    // Update or create user profile in auth.user_profiles
    const existingProfile = await userProfileRepository.findByUserId(session.user.id);

    if (existingProfile) {
      await userProfileRepository.update(session.user.id, {
        hospitalName: hospitalName.trim(),
        onboardingCompleted: true,
        updatedAt: new Date(),
      });
    } else {
      await userProfileRepository.create({
        userId: session.user.id,
        hospitalName: hospitalName.trim(),
        onboardingCompleted: true,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Onboarding API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
