import test from 'node:test';
import assert from 'node:assert/strict';
import {selectContent} from '../selector.mjs';
import {chooseFromCatalogue} from '../core.mjs';

const date='2026-10-03';
const config={translationIds:[54],qwenKey:'test-model-key',
  qwenBaseUrl:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',qwenModel:'qwen-plus',
  botToken:'private-discord-token',discordUserId:'123456789012345678'};
const selection={passageId:'97:1-5',translationId:54,theme:'mountains'};
const reply=(value,extra={})=>Response.json({model:config.qwenModel,
  choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],...extra});

test('Qwen receives public selection context, never Discord credentials or generated caption permissions',async()=>{
  let calls=0;
  const result=await selectContent(config,date,[],()=>{},async(url,init)=>{
    calls++;
    assert.equal(url,config.qwenBaseUrl+'/chat/completions');
    assert.equal(init.headers.Authorization,'Bearer test-model-key');
    assert.equal(init.redirect,'error');
    assert.ok(init.signal instanceof AbortSignal);
    const body=JSON.parse(init.body);
    assert.equal(body.model,'qwen-plus');
    assert.equal(body.temperature,0.0);
    assert.equal(body.enable_thinking,false);
    assert.ok(body.max_tokens<=600);
    assert.ok(!init.body.includes(config.botToken));
    assert.ok(!init.body.includes(config.discordUserId));
    const context=JSON.parse(body.messages[1].content);
    assert.deepEqual(context.translations.map(t=>t.id),[54]);
    return reply({...selection,caption:'Untrusted religious claim'});
  });
  assert.deepEqual(result,{...selection,selector:'qwen',model:config.qwenModel});
  assert.equal(calls,1);
});

test('malformed or unsupported Qwen endpoints preserve autonomous catalogue selection without a request',async()=>{
  for(const endpoint of ['not a URL','ftp://localhost/model','https://example.com/model','http://dashscope-intl.aliyuncs.com/v1']) {
    let calls=0;
    const result=await selectContent({...config,qwenBaseUrl:endpoint},date,[],()=>{},async()=>{calls++;});
    assert.deepEqual(result,chooseFromCatalogue(date,[],[54]));
    assert.equal(calls,0);
  }
});

test('model outages, malformed JSON and unsupported verse or translation choices fall back without publishing model text',async()=>{
  const replies=[
    async()=>{throw new Error('Network unavailable');},
    async()=>new Response('unavailable',{status:503}),
    async()=>Response.json({choices:[{message:{content:'not JSON'}}]}),
    async()=>reply({...selection,passageId:'2:1-5'}),
    async()=>reply({...selection,translationId:131}),
    async()=>reply(selection,{model:'unexpected-model'}),
    async()=>reply(selection,{choices:[{finish_reason:'length',message:{content:JSON.stringify(selection)}}]}),
  ];
  for(const fetcher of replies) {
    assert.deepEqual(await selectContent(config,date,[],()=>{},fetcher),chooseFromCatalogue(date,[],[54]));
  }
});

test('a recent model choice is replaced by an unused complete passage',async()=>{
  const history=[{date:'2026-10-02',passageId:selection.passageId}];
  const result=await selectContent(config,date,history,()=>{},async()=>reply(selection));
  assert.notEqual(result.passageId,selection.passageId);
  assert.equal(result.selector,'catalogue');
});

test('a local Qwen server works without a cloud API key and sends no Authorization header',async()=>{
  const result=await selectContent({...config,qwenKey:'',qwenBaseUrl:'http://127.0.0.1:11434/v1'},date,[],()=>{},async(url,init)=>{
    assert.equal(url,'http://127.0.0.1:11434/v1/chat/completions');
    assert.equal(init.headers.Authorization,undefined);
    assert.equal(JSON.parse(init.body).enable_thinking,undefined);
    return reply(selection);
  });
  assert.equal(result.selector,'qwen');
});

test('Qwen3.7 workspace calls retain validated usage and model provenance without credentials',async()=>{
  const active={...config,qwenModel:'qwen3.7-flash',qwenBaseUrl:'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'};
  const result=await selectContent(active,date,[],()=>{},async(url,init)=>{
    assert.equal(url,active.qwenBaseUrl+'/chat/completions');
    assert.equal(JSON.parse(init.body).enable_thinking,false);
    return reply(selection,{model:active.qwenModel,usage:{prompt_tokens:400,completion_tokens:30,total_tokens:430}});
  });
  assert.equal(result.model,active.qwenModel);
  assert.deepEqual(result.usage,{inputTokens:400,outputTokens:30,totalTokens:430});
  assert.ok(!JSON.stringify(result).includes(active.qwenKey));
  const bad=await selectContent(active,date,[],()=>{},async()=>reply(selection,{model:active.qwenModel,
    usage:{prompt_tokens:-1,completion_tokens:'30',total_tokens:29}}));
  assert.equal(bad.usage,undefined);
});
