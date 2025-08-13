const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = 3001;

// Enable CORS for your local frontend
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: '*'
}));

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Main proxy endpoint that catches all paths
app.all('*', async (req, res) => {
  try {
    // Skip favicon requests
    if (req.path === '/favicon.ico') {
      return res.status(204).end();
    }

    // Extract the path - keep everything as-is
    const path = req.path;
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    
    // Build the target URL - point directly to quran.com API
    const targetUrl = `https://quran.com/api/proxy/content${path}${queryString}`;
    
    console.log(`Proxying request to: ${targetUrl}`);

    // Prepare headers that mimic a request from quran.com
    const headers = {
      'Origin': 'https://quran.com',
      'Referer': 'https://quran.com/media',
      'sec-fetch-site': 'same-origin',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Brave";v="138"',       
      'sec-ch-ua-mobile': '?0',
      'accept': '*/*',
      'accept-language': 'en-GB,en;q=0.5',
      'baggage': 'sentry-environment=vercel-production,sentry-release=quran.com-frontend-next%4025.8.0109,sentry-public_key=a4b19e57881a3274716329ef20981081,sentry-trace_id=9ca15ea2a98247cd84134b2c166d9170,sentry-transaction=%2Fmedia,sentry-sampled=true,sentry-sample_rand=0.06777169728751364,sentry-sample_rate=0.1',
      'sentry-trace': '9ca15ea2a98247cd84134b2c166d9170-9dedb8a2df2c824e-1',
      'priority': 'u=1, i',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-gpc': '1'
    };

    // Include important cookies
    const cookies = [
      'id=2622e625-9af3-4ffb-a042-d8f0b508e850',
      'notif_sub_id=7e21d15d60ac96b19e3e213f9f830934ffa7b10ea68287aadf70570e36741c9e',
      'NEXT_LOCALE=en'
    ];
    headers.Cookie = cookies.join('; ');

    // Forward the original request method and body
    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: headers,
      data: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
      responseType: 'json',
      validateStatus: () => true, // Accept all status codes to handle errors properly
      timeout: 30000 // 30 second timeout
    });

    // Copy status and headers
    res.status(response.status);
    
    // Set necessary headers
    res.setHeader('Content-Type', 'application/json');
    
    // Send the response data
    res.json(response.data);

  } catch (error) {
    console.error('Proxy error:', error.message);
    
    // Return appropriate error
    if (error.response) {
      res.status(error.response.status).json(error.response.data || {
        error: 'API Error',
        message: error.message
      });
    } else {
      res.status(500).json({
        error: 'Proxy Error',
        message: error.message
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`
┌─────────────────────────────────────────────────┐
│                                                 │
│   Quran.com Proxy Server                        │
│   Running at: http://localhost:${PORT}             │
│                                                 │
│   All API requests will be proxied to quran.com │
│   without CORS issues                           │
│                                                 │
└─────────────────────────────────────────────────┘
  `);
});