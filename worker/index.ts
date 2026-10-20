/** Stage-one deployment probe. There is intentionally no financial ingestion route. */
export type Env = { ENVIRONMENT: 'development' | 'staging' | 'production' };
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (new URL(request.url).pathname === '/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ service: 'nestwise', environment: env.ENVIRONMENT, status: 'ok', financialIngestion: false }), { headers });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers });
  },
};
