# Daily Quran agent on AWS

The cloud deployment uses Remotion Lambda rather than an EC2 server. The laptop
does not need to be running for cloud jobs. It retains the frontend's shared
verse overlay, Al-Afasy recitation, verified Jalandhri Urdu text (resource 234),
and separately credited recorded Urdu narration. Qwen selects only from the
existing permitted catalogue; it never supplies Quran text or translation.

New daily dates prepare **two versions of the same passage**: `urdu` plays
Al-Afasy then Shamshad Ali Khan's recorded Urdu narration for each ayah;
`recitation` plays only the complete Al-Afasy recitation. Both show Jalandhri's
verified written Urdu translation. The text panel defaults to **20% opacity**;
`TEXT_PANEL_OPACITY` can configure another value without changing the frontend.
`DAILY_VARIANTS=single` opts new runs out; existing paired/legacy states keep their
original delivery contract. Two distinct Discord messages have independent
checksums, saved progress and receipts. Legacy delivered dates are not resent.

Daily fresh Pixabay remains the first choice. Search/download/validation failures
use the existing bundled stars, sea, nature, snow or abstract clip according to
the saved decorative theme; generated scenery remains the final fallback. No new
stock request is made merely to recover a saved date. Background audio is removed,
original assets remain intact, and credits identify bundled defaults separately
from Pixabay. Their original resolution limits portrait source detail even though
the output remains 1080p. Stock normalization failures also use defaults. An
expired incomplete stock render with no master or delivery attempt can switch
to a default once, preserving its old render ID; active or ambiguous jobs stay
held. Metadata and sampled checks are not an entire-clip human approval.

The two renders run sequentially to respect the current concurrency quota.
Preparation is shared; the second timeline is derived from verified original
recitation timings, without a second Qwen call or a second stock search.
Render polling, video fitting, and delivery use separate resumable invocations,
so compression starts with its full Lambda timeout budget. Retention waits for
both confirmed receipts; Urdu owns shared assets, while each version owns its
individual upload/render. An uncertain version prevents shared media cleanup.

The official upstream production source inspected at
`aff1a035b09b66f28047b3216edcae4c5c949a49` sends `media/generate`, polls
`media/progress/{renderId}` every second, and downloads the returned URL. It uses
Remotion Lambda: `scripts/media/deploy.mjs` calls `deployFunction` and `deploySite`
from `@remotion/lambda`, with memory, disk and timeout supplied through environment
variables. The public files do not give their live values or backend render
chunking/encoding settings, so they cannot establish a speed comparison.
We retain the verified five-worker OffthreadVideo/normalized-loop
implementation and pin existing dependencies instead of merging unrelated upstream
changes. Existing default assets and opacity settings were already present locally.

## Runtime

- Region: `us-east-1`.
- `quran-daily-agent`: Node 22, x86_64, packaged FFmpeg/FFprobe, 3008 MB memory,
  4096 MB temporary disk, 15-minute invocation timeout.
- `remotion-render-4-0-534-mem3008mb-disk10240mb-900sec`: Remotion 4.0.534,
  Node 24, arm64, 3008 MB memory and 10 GB temporary disk. Five render chunks
  leave room within this account's current concurrency quota of ten.
- EventBridge Scheduler group `quran-video-agent`: daily at 06:00
  `Asia/Karachi`, plus a 60-minute catch-up schedule (changed on 24 October 2026). A job starts at 06:00;
  delivery follows rendering and validation.
- Private configuration and durable state:
  `quran-agent-129631621612-us-east-1`.
- Private composition, fonts, audio/background assets, rendered masters and
  Remotion progress: `remotionlambda-useast1-quran-129631621612`.

Both buckets block public access and encrypt objects with SSE-S3. No function
URL, inbound port, public website, or long-lived AWS key is required. The
renderer downloads its composition using its execution role and serves it on
loopback inside each isolated Lambda environment. Font/media access uses
temporary signed URLs; CORS allows the renderer's loopback origin. This also
avoids Remotion's normalization of site URLs, which removes signing queries.
The wrapper preserves the vendor's response-streaming handler interface.

An S3 conditional lease prevents simultaneous agent jobs. Progress is saved
between preparation, rendering, encoding and delivery. Confirmed deliveries
are skipped; `sending` and `uncertain` states require inspection before any
resend. An expired lease can be reclaimed only after the previous invocation's
maximum lifetime. Rendering uses PNG frames at 1080x1920, 30 FPS, H.264 CRF18
and AAC 160k. A separate Discord copy fits the existing configured size limit;
the master remains in private S3 during its recovery period. Background audio is removed. Stock metadata
screening is automated and is distinct from human visual review.

## Build and verification

The cloud package pins all Remotion packages separately from the existing
frontend dependencies. This preserves the local installation.

Cloud bundling replaces the preserved frontend's browser video decoder with
`OffthreadVideo` for FFmpeg frame extraction. Before upload, stock backgrounds
are cropped to the same portrait cover framing, resized to 1080x1920 and prepared
as a silent five-second 30 FPS H.264 CRF16 loop with frequent keyframes. The
original stock file/checksum and credits remain; the manifest records the render
rendition separately. Final video settings stay at CRF18 with the shared overlay.
Saved clips are checked against the current metadata filter before reuse; rejected
subjects use generated scenery without another search or deleting original files.

```sh
cd /home/usama/Work/personal/quran-video-maker/agent/cloud
npm ci
node build.mjs
python3 package-renderer.py
node --test test/*.test.mjs
node smoke-site.mjs
```

`smoke-site.mjs` uses the preserved October 9 local props with decorative
scenery and embedded fonts. It renders a still locally and never sends Discord
messages. `build.mjs` creates a private single-file composition, bundled agent
handler, scoped runtime policies and the original vendor renderer archive.
Package the `build/runtime` directory as a ZIP retaining executable permissions.
`package-renderer.py` preserves the vendor archive's binary permissions when
adding the private site wrapper. Build outputs are ignored by Git.

IAM baseline analysis was generated with AWS IAM Policy Autopilot:

```sh
DISABLE_IAM_POLICY_AUTOPILOT_TELEMETRY=true uvx iam-policy-autopilot@latest generate-policies \
  /home/usama/Work/personal/quran-video-maker/agent/cloud/aws.js \
  /home/usama/Work/personal/quran-video-maker/agent/cloud/renderer-wrapper.cjs \
  --language javascript --region us-east-1 --account 129631621612 \
  --service-hints s3 lambda --pretty
```

`iam-baseline.json` retains the generated baseline. The build narrows it to
the deployed buckets/functions and removes optional API features not used by
the application (object retention, ACLs, object versions and KMS, for example).
The renderer role starts from Remotion's own generated role policy and is
narrowed to its dedicated bucket and function.

Deployment uses private S3 uploads and AWS API operations. Never print the
private `agent/.env`, place it in the site bundle, or include it in a ZIP.
Check that no cloud run is active before replacing the site's fixed key.
CloudWatch logs retain 14 days of execution data. Inspect Lambda `Errors`,
`Throttles`, logs and private `cloud/state.json` if delivery stops.

## Safe schedule changes

Keep exactly one daily scheduler active. Before restoring laptop timers,
disable both cloud schedules and synchronize confirmed cloud receipts into
the local delivery ledger. Preserve uncertain deliveries; never clear them
just to force a retry. Local master files and old compatibility links remain
in place.

After inspecting a failed render, Lambda action `retry-render` permits one repair
of the latest due date only. It requires an expired render with incomplete chunks,
no combining/output artifacts, and no delivery attempt or receipt. It preserves
the passage and original render ID in the audit trail, then prepares fresh assets
and signed URLs. Delivered, sending, uncertain and render-start ambiguity states
are never reset. Old missed dates are not automatically backfilled.

## Media retention

The existing schedules run retention maintenance under the same global lease as
video generation. Only cloud runs with a confirmed Discord message and attachment
receipt are eligible. Imported laptop runs, failed runs, ambiguous delivery
outcomes and missing/mismatched manifests remain untouched.

After delivery, the agent snapshots the exact temporary object keys and their
ETags into the run's durable state. Asset keys come from that run's prepared
composition; no broad bucket listing is needed. After **seven full days from
confirmed delivery**, maintenance deletes only those recorded objects using S3
conditional `IfMatch` requests. Changed objects are retained for inspection.
Partial cleanup is recorded per object and can safely resume without resending.

The cleanup covers the uploaded Discord copy, preview, prepared props, daily
background, render assets and successful render progress. A master is included
only when the delivered attachment used the original master encoding and has the
same SHA256. If Discord received a compressed copy, the distinct high-quality
master stays in private S3 and its key is recorded in the retention receipt.
These exceptional masters can still accumulate; archive or download them before
explicitly approving deletion. Small manifests, attribution, checksums,
selection/background history, Discord receipts, private configuration, the site
bundle and fonts stay available. No local files are removed.

Maintenance initializes old inventories without deleting them in the same
invocation. It runs at least daily, so deletion may occur later than the exact
seven-day cutoff. Retention errors retain pending work and never reset delivery
state or trigger a resend. Explicit Lambda actions `retention-preview` (read-only)
and `retention` (maintenance only) inspect or retry cleanup without starting a
render. The handler does not accept a caller-supplied clock or retention period.

This implementation uses the role's existing GetObject/DeleteObject permissions.
No new IAM policy or S3 Lifecycle rule is needed. Do not enable blanket bucket
expiration, which would also remove recovery data and permanent application
files. These buckets currently have versioning disabled; re-check versioning
before changing retention, since a delete on a versioned bucket leaves noncurrent
versions that can continue accruing storage charges.

Cloud billing includes Lambda execution, S3 requests/storage, logs, and network
transfer. No EC2 instance is needed. Per-render cost depends on duration,
background complexity and memory; use actual render/runtime metrics rather
than a fixed estimate. Confirmed temporary media is automatically cleaned up;
protected masters and small records are retained. This deployment does not
publish a Builder Center submission.

## Stock render benchmark

`stock-benchmark.mjs prepare` builds an isolated fixture under the ignored
`build/stock-benchmark/` directory. It verifies the saved master and stock source
checksums, applies the production stock normalization, and creates a render lasting
slightly over two minutes by repeating the complete Al-Qadr recording twice at its
original speed. Arabic/Urdu audio PCM is checked against the repeated master audio;
no ayah is cut or voice synthesized. This repetition is a stress test only and does
not change daily selections or make a religious recommendation.

`stock-benchmark.mjs payload` reads a single JSON line of short-lived signed input
URLs on stdin and serializes the existing pinned Remotion 4.0.534 SDK request. It
does not invoke AWS or read agent credentials. Use AWS MCP to transfer the fixture,
invoke the existing renderer, inspect progress, download/validate the output and
remove only the isolated benchmark objects. It never sends Discord messages or
updates the daily delivery ledger. Metadata screening and sampled visual inspection
are recorded separately from an entire-clip human approval.

Verified on 12 October 2026: the existing five-worker production renderer completed
all 3,668 frames (about 2:02) in 262.909 seconds with no errors or retries. The
1080x1920/30 FPS master passed native media validation. The production Discord
export function, checked locally, reduced the 257,056,876-byte master to
19,268,983 bytes under the configured 19 MiB cap, preserving the exact encoded
AAC track. This compression reduces picture detail; the quality master is saved
locally. Local export took 223.871 seconds; cloud export timing and a new Discord
send were not exercised by this benchmark. This verifies the tested stock workload,
not an upper bound for every future clip. The five temporary cloud test objects
were removed after download; the daily receipt and both enabled schedules stayed
unchanged. See ignored `build/stock-benchmark/result.json` and `deployment.json`.


### Recovery metadata after the October 2026 cleanup

Retention skips confirmed runs whose manifest or initial preparation metadata is
missing, records their dates/reasons in `cloud.retention.skippedRuns`, and
continues maintaining other valid runs. It does not invent receipts, mark missing
files as cleaned, or delete files based on incomplete metadata. Existing mismatch
and ETag checks still fail closed. Missing historical masters cannot be recovered
from unversioned S3 after deletion; retained Discord copies are not substitutes
for the original high-quality masters.

The execution role also requires `s3:ListBucket` on these two exact buckets
(`recovery-list-policy.json`, deployed as inline policy
`QuranRecoveryObjectExistence` on `QuranDailyAgentLambda`). Without this permission,
S3 reports missing objects as AccessDenied rather than NoSuchKey/NotFound. Genuine
access-denied errors must continue to fail closed. This permission lists names;
it does not add object read/write access beyond the existing scoped policy.
