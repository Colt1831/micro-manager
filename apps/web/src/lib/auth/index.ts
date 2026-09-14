import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb, schema } from '@workmanagement/database';

let _auth: ReturnType<typeof betterAuth> | null = null;

/**
 * Returns a lazy singleton Better Auth instance.
 * The database connection is not established until the first call,
 * so module imports during next build won't fail without a DB.
 *
 * CSRF protection is provided by:
 * - SameSite=Lax cookies (configured below) — browser won't send
 *   session cookies on cross-site POST requests
 * - Better Auth's built-in fetch metadata / origin checks (default)
 * - Custom Origin/Referer validation in withAuth (see api-auth.ts)
 */
export function getAuth(): ReturnType<typeof betterAuth> {
  if (_auth) return _auth;

  _auth = betterAuth({
    baseURL:
      process.env.BETTER_AUTH_URL ??
      process.env.AUTH_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      'http://localhost:3000',
    // Accept either name: Better Auth's native BETTER_AUTH_SECRET or the
    // AUTH_SECRET used by our deploy blueprint / env examples (matching the
    // AUTH_* prefix of the OAuth secrets). Without this, a deploy that follows
    // the docs sets AUTH_SECRET while Better Auth silently reads only
    // BETTER_AUTH_SECRET — so production runs on the default secret and, in
    // production mode, throws on every request. Undefined when neither is set,
    // which keeps Better Auth's fail-closed default-secret guard intact.
    secret: process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verificationTokens,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      requireEmailVerification: false,
      async sendResetPassword(data: { user: { email: string }; url: string }, _request: unknown) {
        const logger = (await import('@/lib/logger')).default;
        // Do NOT log the reset URL at info level — it carries a live,
        // single-use token that grants password reset. Log only the subject.
        logger.info({ email: data.user.email }, '[auth] Password reset requested');

        // In development, log the reset URL so devs can copy-paste it
        if (process.env.NODE_ENV !== 'production') {
          logger.info('\n═══════════════════════════════════════════════════════════════');
          logger.info('🔑 PASSWORD RESET LINK (dev mode):');
          logger.info(`   ${data.url}`);
          logger.info('   Copy and paste this URL into your browser to reset your password.');
          logger.info('═══════════════════════════════════════════════════════════════\n');
        }

        // If RESEND_API_KEY is configured, send the email
        if (process.env.RESEND_API_KEY) {
          try {
            const { sendEmail } = await import('@/lib/email');
            await sendEmail({
              to: data.user.email,
              subject: 'Reset your WorkManager password',
              html: `
                <h1>Reset your WorkManager password</h1>
                <p>Click the link below to reset your password. This link expires in 1 hour.</p>
                <a href="${data.url}" style="color:#6366f1;font-size:16px">Reset password</a>
                <p style="margin-top:24px;color:#71717a;font-size:14px">
                  If you didn't request this, you can safely ignore this email.
                </p>
              `,
            });
          } catch (err) {
            console.error('[auth] Failed to send password reset email:', err);
          }
        }
      },
    },
    socialProviders: {
      google: {
        clientId: process.env.AUTH_GOOGLE_ID ?? '',
        clientSecret: process.env.AUTH_GOOGLE_SECRET ?? '',
      },
      microsoft: {
        clientId: process.env.AUTH_MICROSOFT_ID ?? '',
        clientSecret: process.env.AUTH_MICROSOFT_SECRET ?? '',
      },
    },
    session: {
      cookie: {
        name: 'session_token',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      },
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    rateLimit: {
      window: 60,
      max: 100,
    },
    // Deactivated/suspended user check is handled in withAuth()
    // via checkUserActive() at the API route level.
    // session.cookie.name config is accepted at runtime by better-auth
    // but is not reflected in its current type definitions.
    // The cast is scoped to the config object only; the return type is still
    // properly inferred via ReturnType<typeof betterAuth>.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any) as ReturnType<typeof betterAuth>;

  return _auth;
}
