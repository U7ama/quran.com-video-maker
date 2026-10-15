import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('private renderer retains Lambda response streaming and uses only its private loopback site',async()=>{
  const source=await readFile(new URL('../renderer-wrapper.cjs',import.meta.url),'utf8');
  let loaded=0,received,served;
  const context={awsRequestId:'test',callbackWaitsForEmptyEventLoop:true};
  const responseStream={write(){},end(){}};
  const exports={};
  class GetObjectCommand {constructor(input){this.input=input;}}
  class S3Client {
    async send(command) {
      assert.equal(command.input.Bucket,'remotionlambda-useast1-quran-129631621612');
      assert.equal(command.input.Key,'sites/quran/index.html');
      loaded++;
      return {Body:{transformToString:async()=>'<html>private composition</html>'}};
    }
  }
  const fakeRequire=name=>{
    if(name==='@aws-sdk/client-s3')return {S3Client,GetObjectCommand};
    if(name==='./remotion-renderer.js')return {routine:async(event,stream,ctx)=>{
      assert.equal(stream,responseStream);assert.equal(ctx,context);received=event;return 'rendered';
    }};
    if(name==='node:http')return {createServer:callback=>{
      served=callback;
      return {once(){},listen(port,host,ready){assert.equal(port,8123);assert.equal(host,'127.0.0.1');ready();}};
    }};
    throw new Error('Unexpected dependency');
  };
  vm.runInNewContext(source,{require:fakeRequire,exports,awslambda:{streamifyResponse:fn=>{
    fn.isStreaming=true;return fn;
  }}});
  assert.equal(exports.handler.isStreaming,true);
  assert.equal(await exports.handler({serveUrl:'https://private.example/index.html',nested:{serveUrl:'https://private.example/index.html'}},responseStream,context),'rendered');
  assert.equal(received.serveUrl,'http://127.0.0.1:8123/index.html');
  assert.equal(received.nested.serveUrl,received.serveUrl);
  assert.equal(context.callbackWaitsForEmptyEventLoop,false);
  let status,body;
  served({url:'/index.html'},{writeHead:code=>status=code,end:value=>body=value});
  assert.equal(status,200);assert.match(body,/private composition/);
  served({url:'/other-file'},{writeHead:code=>status=code,end(){}});
  assert.equal(status,404);
  await exports.handler({},responseStream,context);
  assert.equal(loaded,2);
});
