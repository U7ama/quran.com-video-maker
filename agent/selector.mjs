import {PASSAGES, THEMES, TRANSLATIONS, chooseFromCatalogue, validateSelection} from './core.mjs';

export async function selectContent(config, date, history, log = console.log, fetcher = fetch) {
  const fallback = chooseFromCatalogue(date, history, config.translationIds);
  if (!config.qwenKey && !config.qwenBaseUrl) return fallback;
  try {
    const base = new URL(config.qwenBaseUrl);
    const local = ['127.0.0.1','localhost'].includes(base.hostname);
    if (!config.qwenKey && !local) return fallback;
    if (base.username || base.password || !['http:','https:'].includes(base.protocol) || (!local && (base.protocol !== 'https:' ||
        !(base.hostname.endsWith('.aliyuncs.com') || base.hostname.endsWith('.alibabacloud.com'))))) {
      throw new Error('Qwen endpoint must be a local model or an official Alibaba HTTPS endpoint');
    }
    const response = await fetcher(`${base.href.replace(/\/$/,'')}/chat/completions`, {
      method:'POST', headers:{'Content-Type':'application/json',
        ...(config.qwenKey ? {Authorization:`Bearer ${config.qwenKey}`} : {})},
      signal:AbortSignal.timeout(60000), redirect:'error',
      body:JSON.stringify({model:config.qwenModel, max_tokens:600, temperature:0.0,
        ...(!local ? {enable_thinking:false} : {}),
        response_format:{type:'json_object'},
        messages:[{role:'system', content:'Choose identifiers from the supplied catalogue only. Return a JSON object with passageId, translationId (integer), and theme. Respectful Quran presentation: never generate, rewrite or summarize scripture, translations, hadith, tafsir, religious rulings, promises of rewards, or imagery of Allah, prophets or the unseen. Prefer a complete coherent passage and variety. Backgrounds are decorative, never claimed to depict a verse. Do not return any other content.'},
          {role:'user', content:JSON.stringify({date, passages:PASSAGES,
            translations:config.translationIds.map(id=>({id,...TRANSLATIONS[id]})),
            backgroundThemes:THEMES, recentlyUsed:history.slice(-6).map(h=>h.passageId)})}]}),
    });
    if (!response.ok) throw new Error('Qwen selection request failed');
    const data = await response.json();
    if ((!local || data.model) && data.model!==config.qwenModel) throw new Error('Qwen returned a different model');
    if ((!local || data.choices?.[0]?.finish_reason) && data.choices?.[0]?.finish_reason!=='stop') throw new Error('Qwen did not finish its structured selection');
    const selected = validateSelection(JSON.parse(data.choices?.[0]?.message?.content), config.translationIds);
    if (history.slice(-6).some(item=>item.passageId === selected.passageId)) return fallback;
    const usage=data.usage;
    const validUsage=usage && ['prompt_tokens','completion_tokens','total_tokens'].every(key=>Number.isSafeInteger(usage[key]) && usage[key]>=0);
    return {...selected, selector:'qwen',model:config.qwenModel,
      ...(validUsage ? {usage:{inputTokens:usage.prompt_tokens,outputTokens:usage.completion_tokens,totalTokens:usage.total_tokens}} : {})};
  } catch {
    log('Qwen unavailable or returned an invalid choice; using the safe catalogue selector.');
    return fallback;
  }
}
