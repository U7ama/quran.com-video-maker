# Content rules for the daily Quran video agent

These are conservative technical safeguards, not a fatwa or a claim of approval
by a scholar. Ask a qualified scholar you trust about presentation choices or
religious questions. The software cannot certify every interpretation or clip.

## Quran and recitation

- Use Quran.com source text, named published translations, and a named recorded
  reciter. Never use generated Arabic, generated translations or cloned/TTS voices.
- The initial catalogue consists of complete short surahs of at most six verses.
  Never cut an ayah or remove its ending to meet a duration or file-size target.
- Preserve the source recitation speed. No music, beats, stock-video sound, audio
  effects or mixed reciters. Show the verse reference and credit the translator.
- Urdu text is clearly labelled as a translation of meaning. Footnote markers are
  removed for the caption layout; the original source response is retained.
- Urdu speech uses the original frontend's recorded EveryAyah/Shamshad Ali Khan
  files, never TTS. The selected written translation is credited separately;
  the narration is not represented as reading that translator's exact text.
  Verify the provider's published file checksum and measured duration for every
  ayah. Missing or changed narration stops the run; never estimate a duration or
  silently omit a translation. Play Arabic and Urdu consecutively, without overlap.
- Never generate tafsir, hadith, rulings, claims of cures or rewards, sectarian
  statements, or claims that the daily selection is a prescribed religious practice.
- A language model can select identifiers from the fixed catalogue, translation
  allowlist and decorative scene themes only. Invalid choices are discarded.

## Backgrounds

- Locally generated mountains, clouds and night-sky shapes are the generated-mode
  choice and final fallback. Daily stock failures first use the existing bundled
  Quran.com media-maker nature/abstract defaults, selected by decorative theme.
  Windmill imagery is excluded from the conservative automatic preset. Bundled
  assets retain their source attribution and checksum and have all audio removed;
  they are labelled `bundled-catalogue`, not claimed to have human approval.
- Decorative nature scenery does not purport to depict Allah, prophets, angels,
  Paradise, Hell, miracles, or other unseen matters, even if a verse mentions them.
- Pixabay/Pexels search results are not proof of suitable content. In reviewed-library
  modes, review the **entire original video**, not just its title or contact sheet,
  before recording human approval.
- The user's daily fresh-background preset uses unattended metadata screening:
  filmed nature footage, SafeSearch, required nature tags, blocked subjects, source
  and license checks, verified file hashes, and removal of all stock audio.
  It selects a previously unused clip, with a date-stable selection on retries.
  This is not a full visual review or a scholarly certification: tags can omit
  people, animals, logos or other unsuitable details. Automatically screened
  footage is marked `approved=false` and `reviewMode=automated-metadata`.
  Use reviewed-library or generated mode if full prior review is required.
- Daily searches are bounded to one query and at most two downloads per date,
  respect Pixabay's 24-hour response cache, and retain source/creator/license
  credits. If search or screening fails, use fresh locally generated scenery.
- For this conservative preset, reject people, animals, nudity, suggestive scenes,
  religious imagery, statues, advertising, logos, gambling/intoxicants, distressing
  material, distracting edits, or anything you judge disrespectful alongside Quran.
- Record human approval only for clips whose source and permitted usage you have checked. The agent
  records the provider's source, creator, license and file checksum, credits the creator,
  and strips all background audio. A changed file is rejected; automatic screening is only allowed in the explicit daily mode.
- A batch of reviewed backgrounds can be reused automatically in library modes
  without a daily review task. Mixed mode uses locally generated scenery when no
  reviewed stock is available. Daily mode uses fresh screened stock or generated scenery.

## Delivery

- Deliver privately to the configured Discord bot DM: one Arabic-plus-recorded-Urdu
  video and one Arabic-recitation-only video for the same selected passage per date.
  Both retain the verified written Urdu translation. Each version has its own
  durable receipt; never resend a confirmed or uncertain version. Old single-video
  receipts remain valid and are not retroactively supplemented.
- Keep public Quran/stock inputs separate from credentials. Keys stay in the
  ignored private configuration file and never enter the frontend, prompts or video.
- No automatic social publishing. A failed or incomplete content/recitation check
  stops the run; it does not substitute invented content or a silent video.
- If a Discord upload acknowledgement is lost, hold that run for inspection rather
  than automatically send a potential duplicate.
