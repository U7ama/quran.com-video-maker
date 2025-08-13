import { decamelizeKeys } from 'humps';

import stringify from './qs-stringify';
import { getBasePath } from './url';

import { Mushaf, MushafLines, QuranFont, QuranFontMushaf } from '@/types/QuranReader';
import { isStaticBuild } from '@/utils/build';

export const ITEMS_PER_PAGE = 10;

const STAGING_API_HOST = 'https://staging.quran.com';
const PRODUCTION_API_HOST = 'https://api.qurancdn.com';
const LOCAL_PROXY_HOST = 'http://localhost:3001'; // Add this line for local proxy

const API_ROOT_PATH = '/api/qdc';

// env variables in Vercel can't be dynamic, we have to hardcode the urls here.
export const API_HOST =
  process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' ? PRODUCTION_API_HOST : STAGING_API_HOST;

const { API_GATEWAY_URL } = process.env;

/**
 * Determines if we should use local proxy for development
 */
// const shouldUseLocalProxy = () => {
//   return (
//     typeof window !== 'undefined' &&
//     process.env.NODE_ENV === 'development' &&
//     process.env.NEXT_PUBLIC_USE_LOCAL_PROXY === 'true'
//   );
// };

const shouldUseLocalProxy = () => {
  return (
    typeof window !== 'undefined' &&
    // Remove the NODE_ENV check so it works in both dev and production builds
    // process.env.NODE_ENV === 'development' &&
    process.env.NEXT_PUBLIC_USE_LOCAL_PROXY === 'true'
  );
};

/**
 * Generates a url to make an api call to our backend
 *
 * @param {string} path the path for the call
 * @param {Record<string, unknown>} parameters optional query params, {a: 1, b: 2} is parsed to "?a=1&b=2"
 * @returns {string}
 */
export const makeUrl = (path: string, parameters?: Record<string, unknown>): string => {
  // Use local proxy in development mode
  if (shouldUseLocalProxy()) {
    // Route directly through local proxy server
    if (!parameters) {
      return `${LOCAL_PROXY_HOST}${API_ROOT_PATH}${path}`;
    }
    const decamelizedParams = decamelizeKeys(parameters);
    const queryParameters = `?${stringify(decamelizedParams)}`;
    return `${LOCAL_PROXY_HOST}${API_ROOT_PATH}${path}${queryParameters}`;
  }

  // Normal flow for production/staging
  const BASE_PATH = getBasePath();
  const API_PROXY = `${BASE_PATH}/api/proxy/content`;
  const API_URL = isStaticBuild ? `${API_GATEWAY_URL}/content` : API_PROXY;

  if (!parameters) {
    return `${API_URL}${API_ROOT_PATH}${path}`;
  }

  const decamelizedParams = decamelizeKeys(parameters);
  const queryParameters = `?${stringify(decamelizedParams)}`;
  return `${API_URL}${API_ROOT_PATH}${path}${queryParameters}`;
};

// The rest of your file remains the same...

/**
 * Get the default word fields that should exist in the response.
 * qpc_uthmani_hafs is added so that we can use it as a fallback
 * text for QCF font V1, V2 and V4.
 *
 * @param {QuranFont} quranFont the selected quran font since.
 * @returns {{ wordFields: string}}
 *
 */
export const getDefaultWordFields = (
  quranFont: QuranFont = QuranFont.QPCHafs,
): { wordFields: string } => ({
  wordFields: `verse_key,verse_id,page_number,location,text_uthmani,text_imlaei_simple,${
    quranFont === QuranFont.TajweedV4 ? QuranFont.MadaniV2 : quranFont
  }${quranFont === QuranFont.QPCHafs ? '' : `,${QuranFont.QPCHafs}`}`,
});

/**
 * Get the mushaf id based on the value inside redux (if it's not SSR).
 *
 * @param {QuranFont} quranFont
 * @param {MushafLines} mushafLines
 * @returns {{mushaf: Mushaf}}
 */
export const getMushafId = (
  // eslint-disable-next-line default-param-last
  quranFont: QuranFont = QuranFont.QPCHafs,
  mushafLines?: MushafLines,
): { mushaf: Mushaf } => {
  let mushaf = QuranFontMushaf[quranFont];
  // convert the Indopak mushaf to either 15 or 16 lines Mushaf
  if (quranFont === QuranFont.IndoPak && mushafLines) {
    mushaf =
      mushafLines === MushafLines.FifteenLines ? Mushaf.Indopak15Lines : Mushaf.Indopak16Lines;
  }
  return { mushaf };
};
