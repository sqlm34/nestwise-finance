// Keep these exact application origins aligned with app.config.ts. This helper
// defines origin names only; it never enables an environment or authenticates a user.
const nativeOrigins: Readonly<Record<string,string>> = {
  development: 'nestwise-development://',
  staging: 'nestwise-staging://',
  production: 'nestwise://',
};

export function nativeAppOrigin(environment: string): string | null {
  return Object.hasOwn(nativeOrigins,environment) ? nativeOrigins[environment] : null;
}

export function trustedNativeOrigin(origin: string | null, trustedOrigins: readonly string[]): boolean {
  return origin !== null && Object.values(nativeOrigins).includes(origin) && trustedOrigins.includes(origin);
}
