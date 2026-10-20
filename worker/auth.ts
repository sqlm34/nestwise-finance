import type { PostgresPool } from 'kysely' with { "resolution-mode": "import" };
import { Pool, neonConfig } from '@neondatabase/serverless';

export type AuthConfig = {
  baseURL: string; secret: string; origins: string[]; development: boolean;
};
export async function createAuth(config: AuthConfig, pool: PostgresPool) {
  const [{ betterAuth }, { PostgresDialect }, { expo }] = await Promise.all([
    import('better-auth'), import('kysely'), import('@better-auth/expo'),
  ]);
  return betterAuth({
    appName: 'Nestwise',
    baseURL: config.baseURL,
    secret: config.secret,
    database: { dialect: new PostgresDialect({ pool }), type: 'postgres', schemaName: 'nestwise_auth', transaction: true },
    plugins: [expo()],
    trustedOrigins: config.origins,
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    session: { expiresIn: 3600, updateAge: 900, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60,
      customRules: { '/sign-in/email': { window: 60, max: 5 } } },
    advanced: {
      useSecureCookies: !config.development,
      cookiePrefix: 'nestwise',
      ipAddress: { ipAddressHeaders: config.development ? ['x-test-ip'] : ['cf-connecting-ip'] },
    },
    logger: { disabled: true },
    telemetry: { enabled: false },
  });
}
export async function connectAuth(config: AuthConfig, url: string) {
  neonConfig.webSocketConstructor = WebSocket;
  const pool = new Pool({ connectionString: url, max: 2 });
  return { auth: await createAuth(config, {
    options: {}, connect: () => pool.connect(), end: () => pool.end(),
  }), close: () => pool.end() };
}
export type AuthService = Awaited<ReturnType<typeof connectAuth>>;
