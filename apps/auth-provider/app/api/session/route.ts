import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { userRepository, userProfileRepository } from '@/db';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(session);
  }

  try {
    // Get user data from public.users
    const dbUser = await userRepository.findById(session.user.id);

    if (dbUser) {
      // Get profile data from auth.user_profiles
      const profile = await userProfileRepository.findByUserId(dbUser.id);

      // Merge session data with database data
      const enhancedSession = {
        ...session,
        user: {
          ...session.user,
          onboardingCompleted: profile?.onboardingCompleted ?? false,
          f3Name: dbUser.f3Name,
          hospitalName: profile?.hospitalName,
        },
      };
      return NextResponse.json(enhancedSession);
    }
  } catch (error) {
    console.error('Error fetching user data for session:', error);
  }

  return NextResponse.json(session);
}
