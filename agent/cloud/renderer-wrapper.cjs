// Keep the Remotion composition private. Each isolated Lambda environment
// exposes its downloaded HTML only on loopback, never through a public URL.
const http=require('node:http');
const {S3Client,GetObjectCommand}=require('@aws-sdk/client-s3');
const renderer=require('./remotion-renderer.js');
const s3=new S3Client({region:'us-east-1'});
let server,html;

async function prepareSite() {
  const object=await s3.send(new GetObjectCommand({
    Bucket:'remotionlambda-useast1-quran-129631621612',Key:'sites/quran/index.html'}));
  html=await object.Body.transformToString();
  if(!server) {
    server=http.createServer((request,response)=>{
      if(request.url.split('?')[0]!=='/index.html') {
        response.writeHead(404);response.end();return;
      }
      response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
      response.end(html);
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8123,'127.0.0.1',resolve);});
  }
}
function privateServeUrl(value) {
  if(!value || typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)) {
    if(key==='serveUrl')value[key]='http://127.0.0.1:8123/index.html';
    else if(key==='logLevel')value[key]='error';
    else privateServeUrl(item);
  }
}
exports.handler=awslambda.streamifyResponse(async(event,responseStream,context)=>{
  context.callbackWaitsForEmptyEventLoop=false;
  await prepareSite();
  privateServeUrl(event);
  return renderer.routine(event,responseStream,context);
});
