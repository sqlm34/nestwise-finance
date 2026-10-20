import type { ConfigContext, ExpoConfig } from 'expo/config';
export default ({ config }: ConfigContext): ExpoConfig => {
  const environment = process.env.APP_ENV ?? 'development';
  if (!['development', 'staging', 'production'].includes(environment)) throw new Error('Invalid APP_ENV');
  const suffix = environment === 'production' ? '' : `.${environment}`;
  return {
    ...config,
    name: environment === 'production' ? 'Nestwise' : `Nestwise ${environment}`,
    slug: 'nestwise-finance',
    owner: 'alexeasyrepairs-team',
    scheme: `nestwise${environment === 'production' ? '' : `-${environment}`}`,
    ios: { ...config.ios, bundleIdentifier: `com.aksenov.nestwise${suffix}` },
    android: { ...config.android, package: `com.aksenov.nestwise${suffix}` },
    extra: { ...config.extra, environment, eas: { projectId: process.env.EAS_PROJECT_ID || '11e8d655-3b31-4c72-872e-b87cd43ac658' } },
  };
};
