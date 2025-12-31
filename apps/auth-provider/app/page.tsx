import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import ThemeImage from './components/ThemeImage';
import { authOptions } from '@/lib/auth';
import { userRepository, userProfileRepository } from '@/db';
import SignOutButton from './components/SignOutButton';

interface User {
  name: string;
  email: string;
  image: string;
  id: number;
}

interface Session {
  user: User;
}

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function Home({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const session = await getServerSession<typeof authOptions, Session>(authOptions);

  if (!session) {
    redirect('/login?callbackUrl=/');
  }

  // Get user data from public.users
  const userData = await userRepository.findById(session.user.id);

  // Get profile data from auth.user_profiles
  const profile = await userProfileRepository.findByUserId(session.user.id);

  // Preserve any OAuth callback parameters
  const callbackParams = new URLSearchParams();
  Object.entries(resolvedSearchParams).forEach(([key, value]) => {
    if (typeof value === 'string') {
      callbackParams.set(key, value);
    }
  });
  const callbackQuery = callbackParams.toString();
  const callbackSuffix = callbackQuery ? `?${callbackQuery}` : '';

  if (!profile?.onboardingCompleted) {
    redirect(`/onboarding${callbackSuffix}`);
  }

  // If this is an OAuth request (has OAuth parameters), redirect to OAuth authorize endpoint
  if (
    resolvedSearchParams.response_type &&
    resolvedSearchParams.client_id &&
    resolvedSearchParams.redirect_uri
  ) {
    const oauthParams = new URLSearchParams();
    [
      'response_type',
      'client_id',
      'redirect_uri',
      'scope',
      'state',
      'code_challenge',
      'code_challenge_method',
    ].forEach(param => {
      const value = resolvedSearchParams[param];
      if (typeof value === 'string') {
        oauthParams.set(param, value);
      }
    });
    redirect(`/api/oauth/authorize?${oauthParams.toString()}`);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center space-y-4">
          {session.user.image ? (
            <ThemeImage
              src={session.user.image}
              alt="Profile picture"
              width={80}
              height={80}
              className="rounded-full"
            />
          ) : (
            <ThemeImage
              src="/f3nation.svg"
              alt="Profile picture"
              width={80}
              height={80}
              className="rounded-full"
              priority
            />
          )}
          <h1 className="text-2xl font-bold text-center">{userData?.f3Name}</h1>
          <p className="text-lg font-semibold text-center">({profile?.hospitalName})</p>
          <p className="text-gray-600 text-center">{session.user.email}</p>
        </div>
        <SignOutButton />
      </div>
    </div>
  );
}
