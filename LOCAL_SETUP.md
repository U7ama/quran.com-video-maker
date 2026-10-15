# Run the Quran video maker locally

Use Node.js 22. The frontend declares 22.14.0; this checkout was run with 22.16.0.

Start the proxy in one terminal:

```bash
cd proxy
npm install
npm start
```

The proxy listens on http://localhost:3001 and forwards content requests to
`https://quran.com/api/proxy/content`, preserving the API path and query string.

Start the frontend in another terminal:

```bash
cd quran.com-frontend-next
yarn install --frozen-lockfile --ignore-engines
yarn dev
```

This checkout has an ignored `.env.local` with the local proxy enabled. For a
fresh checkout, create that file with:

```dotenv
NEXT_PUBLIC_VERCEL_ENV=development
NEXT_PUBLIC_VERCEL_URL=localhost:3000
NEXT_PUBLIC_USE_LOCAL_PROXY=true
NEXT_PUBLIC_SERVER_SENTRY_ENABLED=false
NEXT_PUBLIC_CLIENT_SENTRY_ENABLED=false
```

Open http://localhost:3000/media. The local proxy flag applies to both the
page's initial server-side data fetch and browser requests. Restart the frontend
after changing environment variables.

To check the proxy independently:

```bash
curl 'http://localhost:3001/api/qdc/audio/reciters?locale=en'
curl 'http://localhost:3001/api/qdc/resources/translations?language=en'
curl 'http://localhost:3001/api/qdc/verses/by_chapter/1?per_page=3&translations=131'
curl 'http://localhost:3001/api/qdc/audio/reciters/7/audio_files?chapter=1&segments=true'
```

The proxy prints each incoming URL and the upstream URL in its terminal.
Audio and background media files may load directly from their media hosts;
the content API requests above use the proxy.

## Verified locally

- `/media` returned HTTP 200 with 21 reciters, 146 translations, verse data,
  and recitation audio metadata in its initial page props.
- Reciters, translations, verses, and chapter audio metadata returned HTTP 200
  through port 3001. The browser CORS preflight returned HTTP 204.
- Changing the surah to Al-Baqarah in Chrome triggered verse and audio requests
  in the proxy log, and the preview displayed verse 2:1 and its translation.
- Video export was not exercised in this startup and proxy check.

## Daily video agent

The separate [daily agent](agent/README.md) now renders without opening the
frontend. Its default is Mishari Al-Afasy, Quran.com's Maulana Muhammad
Fateh Muhammad Jalandhri Urdu translation (Quran.com resource 234), and recorded
Urdu narration credited separately.
`BACKGROUND_MODE=daily` now searches Pixabay for new filmed nature footage each
day, excludes used IDs/hashes, applies SafeSearch and conservative tag filters,
and removes stock audio. The content checks and their limitations are documented
in [ETHICS.md](agent/ETHICS.md). Tags cannot certify every video frame; automatic
screening is explicitly distinguished from human approval in each manifest.
Generated scenery is used when no suitable new clip is available.

The daily agent now renders 1080 × 1920 at 30 FPS with CRF 18 H.264 and 160 kbps
AAC masters retained locally. The private upload budget is 19 MiB. Larger files
use two-pass video compression at full resolution while retaining original AAC
packets and the full Arabic/Urdu timeline. Fresh background selection prioritizes
usable resolution after the portrait crop. See the agent README for size and
source-quality limitations.

On this laptop, system timers are enabled for **06:00 Asia/Karachi** with
`WakeSystem=true`, plus a non-waking catch-up check two minutes after boot and
every 15 minutes while awake. The old user-only timer is disabled. Locked screens
are supported; sleep wake-up depends on hardware, with catch-up after resume.
Powered-off laptops send the latest due video after boot/network recovery and do
not backfill every missed day. The system wrapper holds a sleep inhibitor during
work and runs the application as `usama`. The October 4 logs show a 06:00 resume, followed by a sleep-inhibitor race;
bounded startup retries and temporary idle/lid-switch inhibition now address
that observed failure. The revised policy has not had a physical wake retest,
but actual system-service startup and duplicate skip behavior succeeded. All 46 agent tests pass, including schedule-date
boundaries, missed runs and saved-selection reuse.

Live Discord delivery and Pixabay search/download have succeeded with the
ignored, private `agent/.env`. Queries to Pixabay are cached for 24 hours;
the daily selection is retained so retries do not trigger more searches.

The current agent also shares the frontend's verse overlay and restores its
Arabic-then-Urdu playback. A new five-ayah Al-Qadr sample is about 61 seconds;
all ten Arabic/Urdu recording segments were compared with the rendered audio,
and all captions were inspected. Urdu narration is sourced from the original
frontend's EveryAyah/Shamshad Ali Khan recording set and separately credited
from the chosen written translation.

Qwen selection is now enabled with Qwen3.7-Flash and the existing blindspot-edu
Model Studio workspace/key, copied privately into the Quran agent's `.env`.
A live structured selection succeeded (Al-Asr, Urdu translation 54, mountains;
493 tokens total). Cloud requests disable thinking and validate the returned
model and completion status. `node agent/cli.mjs qwen check` verifies the model
without rendering or sending another Discord message. All 46 agent tests pass.

October 4 delivered Al-Kawthar with a fresh Pixabay ocean clip at 09:34:40 PKT.
All three captions, source checksums/hashes, complete audio timeline and full MP4
decoding were checked. The video is 34.8 seconds, preserving the entire surah
and recorded Urdu narration without padding or stretching. See the run's
`verification.json` and agent README for the startup-race diagnosis and fix.
