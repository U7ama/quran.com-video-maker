# Background inspection tool

The Quran agent already selected complete passages, fetched source text and
recordings, rendered two portrait videos, and delivered them privately. Its
daily stock filter trusted provider tags. This change adds one callable tool,
`inspect_background_video`, to inspect visible content before rendering.

## Agent and tool boundary

Qwen receives a candidate ID and one tool schema. The host validates the name,
single argument and exact candidate ID before binding it to a local asset. The
model cannot choose a path, URL, bucket, recitation, translation or AWS action.
The tool extracts six frames from the first five seconds using the same portrait
cover crop as the video. Amazon Rekognition DetectLabels, DetectModerationLabels
and DetectText inspect each sample. There are at most 18 logical image requests
per candidate; SDK retries are limited to two attempts per request.

The result contains timestamps, detected labels/confidence, model versions,
the input checksum and a policy version. Public detected text is not forwarded
as instructions; the result records only that text was detected. Qwen reads the
tool result and returns a JSON use/fallback choice. Host policy prevents a model
from accepting blocked or incomplete evidence. No generated words enter Quran
text or translation. Inspection does not change the existing catalogue selector.

Any blocked object, moderation finding, text overlay, incomplete frame check,
changed file, unclear nature evidence, or failed final model decision selects
generated scenery. Existing stock-render recovery uses generated scenery while
inspection is enabled, so it cannot introduce an unchecked replacement clip.
Generated scenery needs no Rekognition call. If Qwen is unavailable before the
tool call, the deterministic tool still runs and the trace names that mode.

## Run without delivering

Install the existing pinned cloud dependencies with `npm ci` in `agent/cloud`.
Configure AWS SDK access for us-east-1. The SDK uses its normal credential chain;
do not put AWS keys into prompts or source files. Then, from the repository root:

```sh
node agent/inspection-demo.mjs 2026-10-08
node agent/inspection-demo.mjs 2026-10-05
```

These commands require the corresponding existing local, checksum-verified
public Pixabay clips. They write isolated reports and silent before clips under
ignored `agent/cloud/build/inspection-demo/`. They never call daily/delivery,
change production state or send Discord messages. `background-inspection.json`
records the actual model/tool trace. `result.json` records the latest complete live
run; `verified-tool-loop.json` records a later live Qwen check against cached
Rekognition output when debugging without paying to analyze the same frames again.

## Verification on 23 October 2026

- Pixabay 381029 (saved October 8): metadata filter accepted its nature tags.
  Real Rekognition calls found cars/vehicles at every sampled timestamp, with
  car confidence about 98.8 to 99.3 percent. A sampled frame was visually checked
  and contains cars/buildings. The real Qwen tool loop selected fallback.
- Pixabay 379995 (saved October 5): all six samples had nature evidence and no
  configured blocking findings. A sampled frame was visually checked and shows
  a waterfall. The real Qwen tool loop selected use after the JSON-mode fix.
- Final full end-to-end runs after the Qwen JSON-mode correction passed both
  cases with actual image analysis and real Qwen function calling. Waterfall:
  `video/use/eligible`, 21.528 seconds. Flagged clip: `generated/fallback/blocked`,
  31.063 seconds. Each made one tool call and two model calls. Timings are for
  these two runs only. The earlier JSON-mode failure safely used a fallback.
- All 82 tests passed after the final code changes: 62 local-agent tests and
  20 cloud tests. The two added cloud smoke-test cases verify input confinement,
  checksum rejection and temporary-file cleanup.

Six samples can miss brief or unrecognized content. Detection confidence is not
a probability that a clip is suitable, and no automatic result is human approval
or religious certification. Review complete footage manually when required.

## AWS deployment preparation

The new handler defaults inspection to rekognition; `BACKGROUND_INSPECTION=off`
on the Lambda environment disables it. Local runs remain off unless enabled.
Existing prepared/delivered cloud dates are not regenerated or resent; inspection
applies when preparing new content. No schedules or delivery guards are changed.

`rekognition-iam-baseline.json` is the unmodified IAM Policy Autopilot output:

```sh
DISABLE_IAM_POLICY_AUTOPILOT_TELEMETRY=true uvx iam-policy-autopilot@latest generate-policies \
  /home/usama/Work/personal/quran-video-maker/agent/cloud/rekognition.mjs \
  --language javascript --region us-east-1 --account 129631621612 \
  --service-hints rekognition --pretty
```

`node agent/cloud/build.mjs` prepares the runtime and a supplemental policy at
`agent/cloud/build/rekognition-role-policy.json`. It retains only the generated
three detection actions. The standard model has no project resource; Autopilot's
optional custom-moderation projectversion scope is replaced by Resource `*`,
with aws:RequestedRegion restricted to us-east-1. No S3, face-search, model-training
or IAM permissions are added. AWS's standard API example also uses Resource `*`:
https://docs.aws.amazon.com/rekognition/latest/dg/security_iam_id-based-policy-examples.html

Apply the supplemental policy only to QuranDailyAgentLambda after explicit
approval, then update quran-daily-agent from the prepared private runtime ZIP.
Preserve the current deployed ZIP/hash for rollback. Upload the two exact public fixtures to
`cloud/tool-tests/2026-10-23/{nature,flagged}.mp4` in the existing private bucket.
Invoke `{"action":"inspection-test","candidate":"nature"}` and the matching
`flagged` case to verify the deployed tool before the next scheduled preparation.
The action accepts only these fixed candidates, verifies the source SHA256, and
runs outside the daily lease/state/retention/delivery path. Do not invoke
the daily delivery workflow just to test deployment.


## Live AWS verification — 23 October 2026

The owner approved the necessary deployment and permissions. The existing
QuranDailyAgentLambda role now has only the generated three-action supplemental
Rekognition policy, restricted to us-east-1. quran-daily-agent is Active, with
LastUpdateStatus Successful. Its CodeSha256 matches the tested local ZIP:

`Dr0nlkrlFpYht9wlPtepsuj2RZh9F11/a9LW9LYVtY0=`

Two real inspection-only Lambda invocations passed under the execution role:

- nature: qwen-tool-calling, two model calls, tool eligible, decision use, video kept.
- flagged: qwen-tool-calling, two model calls, tool blocked, decision fallback,
  generated scenery selected. Cars were detected in every sampled frame.

Health confirms backgroundInspection=rekognition, dailyTime=06:00 and
timezone=Asia/Karachi. Both existing daily and five-minute catch-up schedules
remain ENABLED. Today's two confirmed message IDs, render IDs and timestamps
are unchanged from before deployment. No new Quran render or Discord send was
made for testing. The next ordinary new-content preparation uses inspection.

Full sanitized results are in ignored cloud/build/inspection-cloud-verification-2026-10-23.json.
The two temporary S3 fixture objects were conditionally deleted using their exact
ETags after success; the scoped prefix is empty. Re-upload the known public
fixtures before repeating the cloud smoke test. Original local footage, delivered
media, private configuration, existing rollback ZIP and private deployment ZIP remain.
Public challenge article/demo publication is a separate step.
