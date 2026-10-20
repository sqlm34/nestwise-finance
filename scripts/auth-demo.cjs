// Local synthetic authentication service. This script never reads cloud secrets.
const {createServer}=require('node:http');
(async()=>{
  const fixture=await require('./auth-fixture.cjs').createAuthFixture();
  const server=createServer(async(req,res)=>{
    if(!['localhost:8083','127.0.0.1:8083'].includes(req.headers.host)) {res.writeHead(404);res.end();return;}
    try {
      const chunks=[];let size=0;
      for await(const chunk of req) {size+=chunk.length;if(size>16384){res.writeHead(413);res.end();return;}chunks.push(chunk);}
      const request=new Request(`http://localhost:8083${req.url}`,{
        method:req.method,headers:req.headers,
        ...(req.method==='POST'?{body:Buffer.concat(chunks)}:{}),
      });
      const result=await fixture.fetch(request);
      const headers=Object.fromEntries(result.headers);
      if(result.headers.getSetCookie().length)headers['set-cookie']=result.headers.getSetCookie();
      res.writeHead(result.status,headers);res.end(Buffer.from(await result.arrayBuffer()));
    } catch {res.writeHead(503);res.end();}
  });
  server.listen(8083,'127.0.0.1',()=>console.log('Synthetic auth service: http://localhost:8083 — demo@nestwise.test / Synthetic-only-2468!'));
})().catch(()=>{console.error('Synthetic auth service failed.');process.exitCode=1;});
const { Buffer } = require('node:buffer');
