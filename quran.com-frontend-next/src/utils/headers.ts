/* eslint-disable react-func/max-lines-per-function */
import { NextApiRequest } from 'next';

import generateSignature from './auth/signature';
import { isStaticBuild } from './build';

export const X_AUTH_SIGNATURE = 'x-auth-signature';
export const X_TIMESTAMP = 'x-timestamp';
export const X_PROXY_SIGNATURE = 'x-proxy-signature';
export const X_PROXY_TIMESTAMP = 'x-proxy-timestamp';
export const X_INTERNAL_CLIENT = 'x-internal-client';

export const getAdditionalHeaders = (req: NextApiRequest) => {
  let additionalHeaders = {
    // Static headers from the first curl command
    'sec-ch-ua-platform': '"Windows"',
    Referer: 'https://quran.com/',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Brave";v="138"',
    'sec-ch-ua-mobile': '?0',
    // Note: sentry-trace and baggage headers are typically dynamic and based on the current request
    // Adding them as static values may not be ideal for production, but included as requested
    'sentry-trace': '905db2a06fe64498b3e73b92a93f8c13-b8bd217d03c242e3-1',
    baggage:
      'sentry-environment=vercel-production,sentry-release=quran.com-frontend-next%4025.8.0109,sentry-public_key=a4b19e57881a3274716329ef20981081,sentry-trace_id=905db2a06fe64498b3e73b92a93f8c13,sentry-transaction=%2F,sentry-sampled=true,sentry-sample_rand=0.0599322627730523,sentry-sample_rate=0.1',
  };

  if (isStaticBuild) {
    const { signature, timestamp } = generateSignature(
      req,
      req.url,
      process.env.SIGNATURE_TOKEN as string,
    );
    additionalHeaders = {
      ...additionalHeaders,
      [X_AUTH_SIGNATURE]: signature,
      [X_TIMESTAMP]: timestamp,
      [X_INTERNAL_CLIENT]: process.env.INTERNAL_CLIENT_ID,
    };
  }

  if (typeof window === 'undefined') {
    const { signature: proxySignature, timestamp: proxyTimestamp } = generateSignature(
      req,
      req.url,
      process.env.PROXY_SIGNATURE_TOKEN as string,
    );
    additionalHeaders = {
      ...additionalHeaders,
      [X_PROXY_SIGNATURE]: proxySignature,
      [X_PROXY_TIMESTAMP]: proxyTimestamp,
    };
  }

  return additionalHeaders;
};
