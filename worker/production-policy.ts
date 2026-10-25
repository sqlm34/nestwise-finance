// Preparing this policy does not activate production. Deployment flags remain off.
export type ProductionConfiguration = {
  ENVIRONMENT: string; PRODUCTION_RELEASE_APPROVED?: string;
  AUTH_BASE_URL?: string; AUTH_WEB_ORIGIN?: string;
  NESTWISE_DATABASE_URL?: string; AUTH_DATABASE_URL?: string;
};
const origin = 'https://nestwise.universestitch.com';
function databaseTarget(value: string | undefined, role: string): string | null {
  try {
    const url = new URL(value!);
    if (url.protocol !== 'postgresql:' || url.username !== role || !url.password
      || url.pathname !== '/nestwise_production' || url.hash || (url.port && url.port !== '5432')
      || !/^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/.test(url.hostname)
      || [...url.searchParams.keys()].join(',') !== 'sslmode' || url.searchParams.get('sslmode') !== 'require') return null;
    return url.hostname.replace('-pooler.', '.');
  } catch { return null; }
}
export function productionReady(env: ProductionConfiguration): boolean {
  if (env.ENVIRONMENT !== 'production' || env.PRODUCTION_RELEASE_APPROVED !== 'nestwise-production-v1'
    || env.AUTH_BASE_URL !== origin || env.AUTH_WEB_ORIGIN !== origin) return false;
  const runtime = databaseTarget(env.NESTWISE_DATABASE_URL, 'nestwise_production_worker');
  return runtime !== null && runtime === databaseTarget(env.AUTH_DATABASE_URL, 'nestwise_production_auth');
}
