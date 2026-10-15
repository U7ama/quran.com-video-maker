import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {selectComposition,renderStill} from '@remotion/renderer';

const html=await readFile('build/site-private.html');
const server=http.createServer((req,res)=>{
  if(req.url!=='/index.html'){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'text/html'});res.end(html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const props=JSON.parse(await readFile('../data/runs/2026-10-09/render-props.json','utf8'));
  props.background={kind:'generated',theme:'night sky',seed:1};
  props.audioSrc='';props.translationAudio='none';props.fontSources={};
  for(const font of ['UthmanicHafs1Ver18.woff2','NotoNaskhArabic-Regular.woff2','Figtree.ttf','PlayfairDisplay-Black.ttf']) {
    const data=await readFile(`../../quran.com-frontend-next/public/publicMin/${font}`);
    props.fontSources[font]=`data:application/octet-stream;base64,${data.toString('base64')}`;
  }
  const serveUrl=`http://127.0.0.1:${server.address().port}/index.html`;
  const composition=await selectComposition({serveUrl,id:'DailyQuranVideo',inputProps:props,browserExecutable:'/opt/google/chrome/chrome'});
  await renderStill({serveUrl,composition,inputProps:props,frame:1,scale:1.5,
    browserExecutable:'/opt/google/chrome/chrome',output:'build/site-smoke.png'});
  console.log('Private inline site selected and rendered successfully at 1080p.');
} finally {server.close();}
