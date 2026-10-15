import {readFile, writeFile, mkdir, rename, unlink, open, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ROOT_DIR} from './config.mjs';

export const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export async function writeJson(file, data) {
  await mkdir(path.dirname(file), {recursive:true, mode:0o700});
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', {mode:0o600});
  await rename(temporary, file);
}
export async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function getJson(url, {headers = {}, label = 'API', retries = 2} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {headers, signal:AbortSignal.timeout(45000), redirect:'error'});
      if (!response.ok) throw Object.assign(new Error(`${label} HTTP ${response.status}`), {status:response.status});
      return await response.json();
    } catch (e) {
      if (attempt >= retries || (e.status && e.status < 500 && e.status !== 429)) {
        throw new Error(`${label} request failed${e.status ? ` (HTTP ${e.status})` : ''}`);
      }
      await sleep(1000 * (attempt + 1));
    }
  }
}

export function assertMediaUrl(value) {
  const url = new URL(value);
  const allowed = ['download.quranicaudio.com', 'audio.qurancdn.com', 'cdn.qurancdn.com',
    'verses.quran.com', 'videos.pexels.com', 'player.vimeo.com', 'vod-progressive.akamaized.net'];
  const urdu=url.hostname==='everyayah.com' && /^\/data\/translations\/urdu_shamshad_ali_khan_46kbps\/(\d{6}\.mp3|000_checksum\.md5)$/.test(url.pathname);
  const pixabay=url.hostname==='cdn.pixabay.com' && /^\/video\/.+\.mp4$/.test(url.pathname);
  if (url.protocol !== 'https:' || url.username || url.password || (!allowed.includes(url.hostname) && !urdu && !pixabay)) {
    throw new Error('Media URL is outside the permitted HTTPS providers');
  }
  return url;
}

export async function download(value, file, maxBytes = 120 * 1024 * 1024, redirectCount = 0) {
  const url = assertMediaUrl(value);
  if (redirectCount > 4) throw new Error('Too many media redirects');
  const response = await fetch(url, {signal:AbortSignal.timeout(120000), redirect:'manual'});
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    return download(new URL(response.headers.get('location'), url).href, file, maxBytes, redirectCount + 1);
  }
  if (!response.ok || !response.body) throw new Error(`Media download HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel(); throw new Error('Media exceeds download limit');
  }
  await mkdir(path.dirname(file), {recursive:true, mode:0o700});
  const part = `${file}.part`;
  const handle = await open(part, 'w', 0o600);
  let size = 0;
  const limiter = new Transform({transform(chunk, encoding, callback) {
    size += chunk.length;
    callback(size > maxBytes ? new Error('Media exceeds download limit') : null, chunk);
  }});
  try {
    await pipeline(Readable.fromWeb(response.body), limiter, handle.createWriteStream());
    if (!size) throw new Error('Empty media file');
    await rename(part, file);
  } catch (e) { await handle.close().catch(() => {}); await unlink(part).catch(() => {}); throw e; }
  return file;
}

export function command(executable, args, {cwd, timeout = 1800000} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {cwd, stdio:['ignore','pipe','pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-20000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-20000); });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.on('error', error => {clearTimeout(timer); reject(error);});
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${path.basename(executable)} failed (${code}): ${stderr.slice(-1500)}`));
      else resolve(stdout);
    });
  });
}

export async function probe(file) {
  return JSON.parse(await command('ffprobe', ['-v','error','-show_format','-show_streams','-of','json',file]));
}

export async function ensureProxy(config) {
  const origin = new URL(config.proxyUrl).origin;
  const healthy = async () => {
    try { return (await fetch(`${origin}/favicon.ico`, {signal:AbortSignal.timeout(1500)})).status === 204; }
    catch { return false; }
  };
  if (await healthy()) return () => {};
  if (new URL(origin).port !== '3001') throw new Error('Start the configured Quran proxy before running the agent');
  const proxyDir=config.proxyDir || path.join(ROOT_DIR,'proxy');
  const child = spawn(process.execPath, [path.join(proxyDir,'quran-proxy-server.js')],
    {cwd:proxyDir, stdio:'ignore'});
  let failed;
  child.on('error', error => { failed = error; });
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(250);
    if (await healthy()) return () => child.kill();
    if (failed || child.exitCode !== null) break;
  }
  child.kill();
  throw new Error('Could not start the local Quran proxy; install its dependencies first');
}

export async function acquireLock(config) {
  await mkdir(config.dataDir, {recursive:true, mode:0o700});
  const file = path.join(config.dataDir, 'agent.lock');
  try {
    const handle = await open(file, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({pid:process.pid, created:new Date().toISOString()}));
    await handle.close();
    return async () => { await unlink(file).catch(() => {}); };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const lock = await readJson(file, {});
    if (!Number.isInteger(lock.pid)) throw new Error('Invalid agent lock; inspect it before removing it');
    try { process.kill(lock.pid, 0); }
    catch (error) {
      if (error.code === 'ESRCH') {await unlink(file); return acquireLock(config);}
    }
    throw new Error('Another daily agent run is already active');
  }
}

export async function isFile(file) { try {return (await stat(file)).isFile();} catch {return false;} }
