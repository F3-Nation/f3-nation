import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { createAdapter } from './next-auth-adapter';
import { ensureSequenceSynced, userRepository, userProfileRepository } from '@/db';
import { createEmailVerification, verifyEmailCode } from './mfa';

declare module 'next-auth' {
  interface Session {
    user: {
      id: number;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      onboardingCompleted?: boolean;
      hospitalName?: string | null;
      f3Name?: string | null;
    };
  }

  interface User {
    id: number;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    onboardingCompleted?: boolean;
    hospitalName?: string | null;
    f3Name?: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: number;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: 'email',
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        code: { label: 'Verification Code', type: 'text' },
        callbackUrl: { label: 'Callback URL', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.code) {
          // First step - send verification email with magic link
          if (!credentials?.email) {
            throw new Error('Email is required');
          }

          // Create verification with magic link - use provided callback URL or default
          const callbackUrl =
            credentials.callbackUrl || process.env.NEXTAUTH_URL || 'http://localhost:3000';
          await createEmailVerification(credentials.email, callbackUrl);
          return null;
        }

        // Second step - verify code
        if (!credentials.email || !credentials.code) {
          throw new Error('Email and verification code are required');
        }

        // Verify the code via the MFA service (and consume it this time)
        console.log('Attempting to verify email code for:', credentials.email);

        const isValid = await verifyEmailCode(credentials.email, credentials.code, true); // Consume the code

        if (!isValid) {
          console.log('Email verification failed for:', credentials.email);
          throw new Error('Invalid verification code');
        }

        console.log('Email verification successful for:', credentials.email);

        // Create or find user in database (public.users)
        try {
          let existingUser = await userRepository.findByEmail(credentials.email!);

          if (!existingUser) {
            // Ensure the users_id_seq is synced before inserting
            await ensureSequenceSynced();

            // Create new user in public.users
            const f3Name = credentials.email!.split('@')[0];
            existingUser = await userRepository.create({
              f3Name: f3Name,
              email: credentials.email!,
              emailVerified: new Date(),
              status: 'active',
            });

            // Create user profile in auth.user_profiles
            await userProfileRepository.create({
              userId: existingUser.id,
              onboardingCompleted: false,
            });
          } else {
            // User exists, update emailVerified timestamp
            await userRepository.update(existingUser.id, {
              emailVerified: new Date(),
              updated: new Date(),
            });
          }

          // Fetch user profile for onboarding status
          const profile = await userProfileRepository.findByUserId(existingUser.id);

          console.log('Successfully found/created user:', existingUser);
          // Map database fields to NextAuth expected fields
          return {
            id: existingUser.id,
            name: existingUser.f3Name,
            email: existingUser.email,
            image: existingUser.avatarUrl,
            onboardingCompleted: profile?.onboardingCompleted ?? false,
            hospitalName: profile?.hospitalName,
            f3Name: existingUser.f3Name,
          };
        } catch (dbError) {
          console.error('Database error:', dbError);
          throw new Error('Database error occurred during user creation/lookup');
        }
      },
    }),
  ],
  adapter: createAdapter(),
  session: {
    strategy: 'jwt', // Use JWT for credentials providers
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET,
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production' ? '__session' : 'next-auth.session-token',
      options: {
        path: '/',
        httpOnly: true,
        sameSite: 'none', // Allow cross-site cookies for OAuth flow
        secure: true, // Required when sameSite is 'none'
      },
    },
  },
  callbacks: {
    async signIn() {
      return true;
    },
    async jwt({ token, user }) {
      // If user is provided (during sign in), add user info to token
      if (user) {
        token.id = user.id as number;
        token.name = user.name;
        token.email = user.email;
        token.image = user.image;
      }
      return token;
    },
    async session({ session, token }) {
      // Send properties to the client
      if (token) {
        session.user.id = token.id as number;
        session.user.name = token.name as string | null;
        session.user.email = token.email as string | null;
        session.user.image = token.image as string | null;

        // Fetch additional user data from database (join users + user_profiles)
        try {
          const dbUser = await userRepository.findById(token.id as number);

          if (dbUser) {
            session.user.f3Name = dbUser.f3Name;

            // Fetch profile data
            const profile = await userProfileRepository.findByUserId(dbUser.id);

            if (profile) {
              session.user.onboardingCompleted = profile.onboardingCompleted;
              session.user.hospitalName = profile.hospitalName;
            }
          }
        } catch (error) {
          console.error('Error fetching user data in session callback:', error);
        }
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      console.log('NextAuth redirect callback:', { url, baseUrl });

      // If url starts with "/", it's a relative path - make it absolute
      if (url.startsWith('/')) {
        const fullUrl = `${baseUrl}${url}`;
        console.log('Redirecting to relative URL:', fullUrl);
        return fullUrl;
      }

      // If url is already absolute, validate it
      try {
        const urlObj = new URL(url);
        const baseUrlObj = new URL(baseUrl);

        // Allow same origin redirects
        if (urlObj.origin === baseUrlObj.origin) {
          console.log('Redirecting to same origin URL:', url);
          return url;
        }

        // Allow known client domains for OAuth flow
        const allowedOrigins = [
          'https://app.freemensworkout.org',
          'https://app2.freemensworkout.org',
          'https://localhost:3001',
          'http://localhost:3001',
        ];

        if (allowedOrigins.includes(urlObj.origin)) {
          console.log('Redirecting to allowed client origin:', url);
          return url;
        }

        // Allow subdomain redirects for production
        const baseHost = baseUrlObj.hostname;
        const targetHost = urlObj.hostname;
        if (
          targetHost === baseHost ||
          targetHost.endsWith('.' + baseHost.split('.').slice(-2).join('.'))
        ) {
          console.log('Redirecting to subdomain URL:', url);
          return url;
        }

        console.log('URL not allowed, redirecting to baseUrl:', { url, baseUrl });
      } catch (e) {
        console.error('Redirect callback URL parsing error:', e, 'url:', url, 'baseUrl:', baseUrl);
      }

      // Default to baseUrl if anything goes wrong
      console.log('Defaulting to baseUrl:', baseUrl);
      return baseUrl;
    },
  },
};
