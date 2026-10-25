type Failure = { event: 'request_failure'; environment: string; status: number; incident: string };
export async function observeRequest(operation: () => Promise<Response>, environment: string,
  log: (event: Failure) => void = event => console.error(JSON.stringify(event))): Promise<Response> {
  let result: Response;
  try { result = await operation(); }
  catch { result = Response.json({error:'temporarily_unavailable'}, {status:503,headers:{'Cache-Control':'no-store'}}); }
  if (result.status < 500) return result;
  const incident = crypto.randomUUID();
  // Never log request paths, query strings, tokens, documents or exception text.
  log({event:'request_failure',environment:['development','staging','production'].includes(environment)?environment:'unknown',status:result.status,incident});
  const response = new Response(result.body,result);
  response.headers.set('X-Nestwise-Incident',incident);
  response.headers.set('Cache-Control','no-store');
  response.headers.set('X-Content-Type-Options','nosniff');
  return response;
}
