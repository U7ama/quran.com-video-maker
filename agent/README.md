# Daily Quran Agent

The agent runs on this laptop, selects a complete short surah, fetches verified
Arabic/Urdu text and Mishari Al-Afasy's recitation through the local proxy,
renders a portrait MP4, then sends it to your Discord bot DM once per Pakistan
date. It starts the proxy if needed; the Next.js app and browser can be closed.

The current preset is **06:00 Asia/Karachi**, reciter **7**, Urdu translation
**234: Fateh Muhammad Jalandhri** (Quran.com's resource name:
**Fatah Muhammad Jalandhari**). Qwen and the catalogue fallback are restricted
to this translation in the active preset. As in the original frontend, each Arabic
ayah is followed by recorded Urdu narration from EveryAyah (Shamshad Ali Khan),
with a half-second pause. The written translation and the recorded narration
are separately credited; they are not claimed to be the same wording or author.
Every recording is checked against EveryAyah's published checksum and its
duration is measured; missing audio stops the run instead of guessing a length.
The requested
1–2 minute length is a preference: complete short surahs may be shorter, and the
agent does not stretch recitation or cut verses to fill a duration target.

Read [ETHICS.md](ETHICS.md) for the content safeguards and their limits.

The frontend export and the daily agent now use the same `VerseOverlay`
component and stylesheet: Quran.com logo at the top left, Arabic surah/juz
information at the top right, and the original centered verse/translation box.
The default font scales, colors, opacity and border match the frontend preset.
Generated, reviewed, or automatically screened stock scenery can differ each day. Source and
translator credits are preserved in the manifest and Discord message.

`TRANSLATION_AUDIO=urdu` is the default Arabic-then-Urdu playback mode.
Use `none` for Arabic only or `urdu-only` for recorded Urdu narration only.

## New background inspection tool

The optional `inspect_background_video` tool uses Amazon Rekognition to check
six frames from the five-second portrait loop used behind the verses. Qwen
makes a real function call, consumes its result, and chooses whether to use the
candidate or generated scenery. Deterministic checks prevent the model from
overriding a blocked or incomplete inspection. See [tool behavior, evidence and
deployment](BACKGROUND_TOOL.md).

Local runs retain `BACKGROUND_INSPECTION=off` by default. Set it to `rekognition`
to enable the tool after installing the cloud package and configuring AWS access.
The cloud handler enables it by default, with an explicit `off` override
available for rollback. Deployed and verified on AWS on 23 October 2026: both
the nature acceptance and car-footage rejection checks passed in Lambda.

## Setup

Use Node 22 and the existing frontend/proxy dependencies, plus FFmpeg, FFprobe
and Chrome. No new Node dependencies are needed.

```bash
cd agent
node cli.mjs init
node cli.mjs doctor
```

Edit the ignored `agent/.env` locally. For a bot DM, fill:

```dotenv
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_USER_ID=your_discord_user_id
```

Create a bot using the [Discord Developer Portal](https://discord.com/developers/applications).
Install it in a private server you use, allow DMs from that server and enable
Discord Developer Mode to copy your user ID. The agent checks that the token is
for a bot; user-account tokens/self-bots are not supported. No privileged
message-content or presence intent is needed for this workflow. Do not paste
the token in chat or put it in a `NEXT_PUBLIC_*` variable.

```bash
node cli.mjs sample --passage 97:1-5  # local MP4 only, no message
node cli.mjs daily                  # today's real video; delivery is recorded
node cli.mjs daily                  # skips if today's DM was confirmed
```

Outputs and source manifests are in `agent/data/runs/`. Each run preserves the
source response, recitation recording/hash, render props, preview PNG, full MP4,
upload MP4 if compressed, and delivery state. Outputs are retained locally.
The agent renders **1080 × 1920 at 30 FPS**, capturing the shared frontend layout
at 1.5× pixel density so text is drawn sharply without changing its proportions.
The local H.264 master uses CRF 18, lossless PNG frame capture and 160 kbps AAC.
The master is retained even when it is larger than the Discord upload budget.

`DISCORD_MAX_MIB=19` leaves room below Discord's current default
[20 MiB per-file limit](https://docs.discord.com/developers/reference#uploading-files).
Masters already within the budget are uploaded directly. Larger masters get a
1080p two-pass H.264 copy sized for their complete duration, preserving the AAC
audio packets without another lossy audio encode. A bounded second attempt uses
the measured file size if the first estimate overshoots; oversized files are
never sent. Long clips have a lower available video bitrate at this fixed limit.
No verses are shortened, no audio is stretched and resolution stays at 1080p.

Fresh Pixabay searches request at least 1080 pixels in each dimension and prefer
renditions with enough detail after the portrait crop, within the existing
70 MiB download cap. A 4K landscape may retain more detail than a 720p portrait.
Previously saved daily backgrounds are reused on retries, so today's original
low-resolution stock footage remains unchanged. Source resolution still limits
background detail; a 1080p output cannot restore missing source pixels.

## Daily laptop schedule and missed runs

This laptop now uses **system timers**, so it does not require an unlocked screen
or a user login to start the agent. The old user-only timer is disabled.

- **Locked:** background generation and Discord delivery run normally.
- **Suspended/asleep:** the daily system timer requests a wake-up at 06:00 PKT
  using `WakeSystem=true`. Actual wake-up depends on the laptop's hardware/firmware;
  the October 4 logs confirm a resume at 06:00. That first run exposed a
  sleep-transition inhibitor race and a return to sleep with the lid closed;
  startup retry and temporary lid/idle inhibition now address these cases.
  A physical suspend/wake cycle with the revised policy has not yet been tested.
  If waking fails, catch-up occurs after resume.
- **Powered off:** no code can run while power is off. The boot catch-up timer
  checks two minutes after boot, without requiring login, once this filesystem
  is accessible. Network failures are retried during subsequent awake checks.
- **Network unavailable or interrupted render:** checks repeat every 15 minutes
  while awake. A persisted selection is reused to avoid repeated Qwen calls;
  Pixabay's saved daily selection is also reused. The timer does not wake the
  laptop every 15 minutes.

The deadline selects the **latest due date**. For example, booting at 05:30 on
October 4 checks the October 3 video; it does not send October 4 early. At 06:00,
October 4 becomes due. After several missed days, only the most recent due date
is generated, rather than a batch of all missed videos. Confirmed dates are
skipped; unconfirmed uploads are held to prevent duplicates.

The system service acquires sleep, idle and lid-switch inhibitors, then runs Node, Chrome and FFmpeg
as `usama` through `runuser`. Only the inhibitor wrapper is privileged; application
credentials remain in the private user-owned `.env`. The inhibitor is released
on completion/failure. It does not block power-off or forced sleep. Inhibitor
launch failures retry after five seconds, limited to six starts in two minutes.
Application failures exit 70 and use the normal 15-minute catch-up instead of
rapid retries; missing configuration exits 78. A 45-minute
service timeout limits interrupted or stalled work.

To generate and install the same setup on this laptop:

```bash
node cli.mjs schedule --system
sudo install -m 0644 systemd-system/quran-video-agent.service systemd-system/quran-video-agent.timer systemd-system/quran-video-agent-catchup.timer -t /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now quran-video-agent.timer quran-video-agent-catchup.timer
systemctl list-timers 'quran-video-agent*'
journalctl -u quran-video-agent.service -n 60
```

`node cli.mjs due` checks the latest due date directly. `daily` remains the manual
command for today's date. `schedule` without `--system` generates a user-manager
fallback without physical wake support; it needs a running user manager. Change
`.env`, regenerate/reinstall units and reload systemd to change the scheduled time.

```bash
sudo systemctl disable --now quran-video-agent.timer quran-video-agent-catchup.timer
```

The configured time starts generation; delivery follows after rendering and
uploading. Exact 06:00 delivery while a laptop is powered off requires a separate
always-on host/cloud deployment, which has not been provisioned.

## Qwen selection

The laptop is configured with **qwen3.7-flash** using the same Alibaba Singapore
workspace and private API configuration as blindspot-edu. DeviceOps and
blindspot-edu use the same OpenAI-compatible Model Studio interface. Their
source projects were left unchanged; the Quran agent has its own ignored,
permission-restricted `.env`.

To configure another installation, set `QWEN_API_KEY`, `QWEN_BASE_URL`, and
`QWEN_MODEL` for your Alibaba region/workspace using the
[Model Studio endpoint guide](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope).
The API key and endpoint region must match. A local OpenAI-compatible Qwen server
on localhost also works without a cloud key.

The cloud request uses JSON output, `enable_thinking=false`, temperature 0,
a 600-token response cap, and a 60-second timeout. It sends only the public
passage catalogue, permitted translation identifiers, decorative themes, date,
and recent passage identifiers; Discord and stock credentials are excluded.
The returned model identity, completion status and selected identifiers are
validated. Only a complete valid selection can enter the workflow. Outages,
invalid responses and recently used choices fall back to the built-in selector.
Accepted model identity and numeric token usage are retained in the run manifest.
Qwen does not write Quran text, translations or religious claims, and does not
inspect stock-video frames. Selection remains limited to the nine short surahs
in the current catalogue.

```bash
node cli.mjs qwen check  # one live model selection, no render or Discord message
```

The live check passed with Qwen3.7-Flash selecting Al-Asr (`103:1-3`), translation
54 and mountains, with 455 input and 38 output tokens. Its public, validated
receipt is in `agent/data/qwen-check.json`. The daily timer reads `.env` at each
run, so the configured model is active for subsequent runs without a restart.

## AWS cloud deployment

The unattended agent has a separate Remotion Lambda deployment under
[`cloud/README.md`](cloud/README.md). It uses private S3 storage and EventBridge
Scheduler so daily generation can run while the laptop is off. Keep only one
daily scheduler enabled and check the cloud receipt before restoring local
timers. The cloud package leaves the existing frontend dependencies intact.

## Optional free stock backgrounds

The default stock provider is now **Pixabay**. Log into the
[Pixabay API documentation](https://pixabay.com/api/docs/) to obtain your API
key and set these in the private `.env`:

```dotenv
BACKGROUND_PROVIDER=pixabay
PIXABAY_API_KEY=your_key
BACKGROUND_MODE=daily
```

`BACKGROUND_MODE=daily` makes one bounded Pixabay search per Pakistan date,
selects a previously unused clip, downloads it, removes its audio, and uses it
behind the Quran overlay. The search uses filmed footage, nature category,
`safesearch=true`, latest ordering, and a per-theme page cursor. Responses to the
same query are cached for 24 hours as Pixabay requires; retries reuse the same
saved daily selection and make no new search. At most two filtered clips are
downloaded if the first fails validation. The IDs and hashes of past daily
selections and approved library clips are excluded. An unavailable API, empty
page, duplicate file, or lack of suitable results uses date-seeded generated
scenery, without silently repeating an old stock clip.

Automatic screening requires nature tags and rejects tagged people, animals,
religious imagery, logos, music, and other excluded subjects. **Metadata filters
and SafeSearch cannot inspect or certify every frame.** The manifest records
`reviewMode=automated-metadata`, `approved=false`, and
`backgroundAutomaticallyScreened=true`; it does not claim a full human review.
See ETHICS.md for the limits. The source, creator and
[Pixabay Content License](https://pixabay.com/service/license-summary/) are
included in the Discord message. Raw daily stock clips are retained for seven
dates; rendered videos and the ID/hash audit history remain available.

The two approved clips are still available for the optional reviewed-library
mode. To add to that library:

```bash
node cli.mjs backgrounds fetch --theme "mountains"
# View the entire returned candidate video and check ETHICS.md.
node cli.mjs backgrounds approve pixabay-VIDEO_ID --reviewed
```

`mixed` selects reviewed footage or generated scenery; `approved` requires a
reviewed clip; `generated` uses only local scenery. These modes do not make
unattended stock searches. The active laptop preset is now `daily`.

Pexels remains available with `BACKGROUND_PROVIDER=pexels` and `PEXELS_API_KEY`,
including existing approved libraries. New Pexels candidates use IDs such as
`pexels-123`, so equal numeric IDs from different providers cannot overwrite each
other. Its [API page](https://www.pexels.com/api/) currently reports that issuing
new keys is paused. Provider-specific reviewed libraries are kept separately;
switching to Pixabay does not silently select Pexels clips.

## An unconfirmed upload

If Discord accepted the upload but the response was lost, automatic retries are
held to avoid duplicates. Inspect your DM and record the message ID, or explicitly
unlock it only after verifying that no video arrived:

```bash
node cli.mjs delivery confirm YYYY-MM-DD DISCORD_MESSAGE_ID
node cli.mjs delivery retry YYYY-MM-DD --checked-no-message
```

After a confirmed delivery, the same date will not send again. Credentials and
generated files are ignored by Git. Run `node --test test/*.test.mjs` for the
content-validation, background-review, upload and delivery-state checks.

The restored frontend layout/Urdu sample was rendered and visually inspected,
and all ten Arabic/Urdu segments were compared with the original recordings.
All 50 agent tests pass, including actual 1080p two-pass encoding, exact AAC packet
preservation, duration/resolution verification and stock rendition ranking, plus
Pixabay caching, daily fresh selection and retries, license/provenance checks,
provider-qualified identities, actual removal of background audio, and source
credits. Pixabay API request/response behavior is tested with fixtures, and live search/download and Discord DM delivery have succeeded on this laptop. The frontend page returns HTTP 200. The full frontend
TypeScript check still reports five existing errors in unchanged `VideoUpload`,
`gtag`, and `headers` files; no errors remain in the changed video components.

## October 4 delivery verification

The first scheduled run selected Al-Kawthar (`108:1-3`) using Qwen3.7-Flash,
translation 54, and a fresh Pixabay ocean clip (`379849`). It rendered a 34.8-second
720 × 1280, 30 FPS video and confirmed the Discord DM at 09:34:40 PKT. All three
caption frames were inspected; the complete MP4 decoded without errors; uploaded
file and source recitation hashes, Urdu checksums and the complete playback
timeline were verified. Results are retained in the run's `verification.json`.

The laptop resumed at 06:00, but the first inhibitor request raced the sleep
transition. With the lid closed it slept again at 06:00:30. After the lid opened
at 09:17, a catch-up run succeeded at 09:30. The system service has now been
updated with bounded five-second startup retries and temporary idle/lid-switch
inhibitors. It was validated and successfully launched with today's delivery
correctly skipped. This verifies the installed launcher, not a new physical
suspend/wake cycle. All 46 agent tests pass.

## October 4 quality upgrade verification

A complete Al-Kawthar preview was rendered at 1080 × 1920, 30 FPS using today's
saved, checksum-verified Arabic/Urdu recordings and the unchanged daily background.
The 34.8-second CRF 18 master is 44.7 MiB; the two-pass Discord copy is 18.3 MiB,
within the active 19 MiB budget. The copy decoded completely without errors,
its AAC packets match the master exactly, and all three caption frames were
visually inspected. Local results are in `agent/data/runs/quality-2026-10-04/`.
No additional Discord message was sent. All 50 agent tests pass; the encoding
tests were rerun after tightening duration/frame-rate validation.
