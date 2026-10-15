import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const AGENT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.dirname(AGENT_DIR);
export const FRONTEND_DIR = path.join(ROOT_DIR, 'quran.com-frontend-next');

export async function loadConfig(overrides = {}) {
  let file = {};
  try { file = parseEnv(await readFile(path.join(AGENT_DIR, '.env'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const env = {...file, ...process.env, ...overrides};
  const number = (key, fallback, min, max) => {
    const value = Number(env[key] || fallback);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  const timezone = env.TIME_ZONE || 'Asia/Karachi';
  new Intl.DateTimeFormat('en', {timeZone: timezone}).format();
  const dailyTime = env.DAILY_TIME || '06:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyTime)) throw new Error('DAILY_TIME must be HH:MM');
  const translationIds = (env.TRANSLATION_IDS || '234').split(',').map(Number);
  const allowedTranslations = new Set([54, 234, 131, 20, 84]);
  if (!translationIds.length || translationIds.some(id => !allowedTranslations.has(id))) {
    throw new Error('TRANSLATION_IDS must use the supported verified translation list: 54,234,131,20,84');
  }
  const proxyUrl = new URL(env.QURAN_PROXY_URL || 'http://127.0.0.1:3001/api/qdc');
  if (proxyUrl.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(proxyUrl.hostname)) {
    throw new Error('QURAN_PROXY_URL must point to the local Quran proxy');
  }
  const backgroundMode = env.BACKGROUND_MODE || 'mixed';
  if (!['generated', 'approved', 'mixed', 'daily'].includes(backgroundMode)) throw new Error('Invalid BACKGROUND_MODE');
  const backgroundProvider=env.BACKGROUND_PROVIDER || (env.PEXELS_API_KEY && !env.PIXABAY_API_KEY ? 'pexels' : 'pixabay');
  if (!['pixabay','pexels'].includes(backgroundProvider)) throw new Error('BACKGROUND_PROVIDER must be pixabay or pexels');
  if (backgroundMode==='daily' && backgroundProvider!=='pixabay') throw new Error('Daily fresh backgrounds require BACKGROUND_PROVIDER=pixabay');
  const translationAudio=env.TRANSLATION_AUDIO || 'urdu';
  if (!['none','urdu','urdu-only'].includes(translationAudio)) throw new Error('Invalid TRANSLATION_AUDIO');
  return {
    timezone, dailyTime, translationIds, proxyUrl: proxyUrl.href.replace(/\/$/, ''), backgroundMode, backgroundProvider, translationAudio,
    dailyVariants:env.DAILY_VARIANTS!=='single',
    textPanelOpacity:number('TEXT_PANEL_OPACITY',0.2,0,1),
    reciterId: number('RECITER_ID', 7, 1, 10000),
    targetSeconds: number('TARGET_SECONDS', 90, 5, 300),
    maxSeconds: number('MAX_SECONDS', 180, 15, 600),
    discordMaxBytes: Math.floor(number('DISCORD_MAX_MIB', 19, 1, 20) * 1024 * 1024),
    webhookUrl: env.DISCORD_WEBHOOK_URL || '', botToken: env.DISCORD_BOT_TOKEN || '',
    discordUserId: env.DISCORD_USER_ID || '',
    qwenKey: env.QWEN_API_KEY || '', qwenBaseUrl: env.QWEN_BASE_URL || '',
    qwenModel: env.QWEN_MODEL || 'qwen3.7-flash', pexelsKey: env.PEXELS_API_KEY || '',
    pixabayKey:env.PIXABAY_API_KEY || '',
    concurrency: Math.floor(number('RENDER_CONCURRENCY', 2, 1, 8)),
    chromePath: env.CHROME_PATH || '/opt/google/chrome/chrome',
    dataDir: path.join(AGENT_DIR, 'data'),
    publicDir: path.join(FRONTEND_DIR, 'public', 'publicMin'),
  };
}

export function dayKey(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = type => parts.find(p => p.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
