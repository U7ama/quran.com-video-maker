/* eslint-disable max-lines */
/* eslint-disable i18next/no-literal-string */
/* eslint-disable react/no-danger */
/* eslint-disable no-unsafe-optional-chaining */
import { useCallback, useEffect, useMemo, useState } from 'react';

import classNames from 'classnames';
import {
  AbsoluteFill,
  Audio as RemotionAudio,
  Sequence,
  Video,
  staticFile,
  prefetch,
} from 'remotion';

import styles from './MediaMakerContent.module.scss';

import useGetChaptersData from '@/hooks/useGetChaptersData';
import Alignment from '@/types/Media/Alignment';
import { Timestamp } from '@/types/Media/GenerateMediaFileRequest';
import Orientation from '@/types/Media/Orientation';
import { QuranFont } from '@/types/QuranReader';
import Translation from '@/types/Translation';
import Verse from '@/types/Verse';
import { getChapterData } from '@/utils/chapter';
import { toLocalizedNumber } from '@/utils/locale';
import defaultChaptersData from '@/utils/media/defaultChaptersData.json';
import { convertHexToRGBA } from '@/utils/media/helpers';
import getPlainTranslationText from '@/utils/plainTranslationText';

type Props = {
  verses: Verse[];
  audio: any;
  video: any;
  timestamps: Timestamp[];
  translationAudio?: string;
  backgroundColor: string;
  opacity: number;
  borderColor: string;
  borderSize: number;
  fontColor: string;
  verseAlignment: string;
  translationAlignment: string;
  quranTextFontScale: number;
  quranTextFontStyle: QuranFont;
  translationFontScale: number;
  orientation: Orientation;
  chapterEnglishName: string;
  isPlayer?: boolean;
  durationInFrames?: number;
  showArabic?: boolean;
  showLogo?: boolean;
  showSurahInfo?: boolean;
};

const WORD_SURAH = 'سُورَة';
const MediaMakerContent: React.FC<Props> = ({
  verses,
  audio,
  video,
  timestamps,
  backgroundColor,
  opacity,
  borderColor,
  borderSize,
  fontColor,
  verseAlignment,
  translationAlignment,
  quranTextFontScale,
  quranTextFontStyle,
  translationFontScale,
  orientation,
  chapterEnglishName,
  isPlayer = false,
  translationAudio = 'none',
  durationInFrames,
  showArabic = true,
  showLogo = true,
  showSurahInfo = true,
}) => {
  const chaptersDataArabic = useGetChaptersData('ar');
  const firstVerseTiming = audio?.verseTimings[0];
  const [translationDurations, setTranslationDurations] = useState<Record<string, number>>({});
  const startFrom = useMemo(() => {
    const normalizedStart = firstVerseTiming?.normalizedStart;

    return normalizedStart
      ? (normalizedStart / 1000) * 30
      : (firstVerseTiming?.timestampFrom / 1000) * 30;
  }, [firstVerseTiming?.normalizedStart, firstVerseTiming?.timestampFrom]);

  const endAt = useMemo(() => {
    const verseTiming = audio?.verseTimings[audio?.verseTimings?.length - 1];

    return firstVerseTiming?.normalizedEnd
      ? (verseTiming?.normalizedEnd / 1000) * 30
      : (verseTiming?.timestampTo / 1000) * 30;
  }, [audio?.verseTimings, firstVerseTiming?.normalizedEnd]);

  const audioHasStartAndEndRanges = typeof startFrom === 'number' && typeof endAt === 'number';

  // Function to generate translation audio URLs
  const getTranslationAudioUrl = useCallback(
    (chapterId, verseNumber) => {
      if (translationAudio === 'urdu' || translationAudio === 'urdu-only') {
        const paddedChapter = String(chapterId).padStart(3, '0');
        const paddedVerse = String(verseNumber).padStart(3, '0');
        return `https://everyayah.com/data/translations/urdu_shamshad_ali_khan_46kbps/${paddedChapter}${paddedVerse}.mp3`;
      }
      return null;
    },
    [translationAudio],
  );

  // Preload all translation audio files
  useEffect(() => {
    if (
      (translationAudio === 'urdu' || translationAudio === 'urdu-only') &&
      verses &&
      verses.length > 0
    ) {
      const newDurations: Record<string, number> = {};

      const fetchDurations = async () => {
        const promises = verses.map(async (verse) => {
          const audioUrl = getTranslationAudioUrl(verse.chapterId, verse.verseNumber);
          if (audioUrl) {
            try {
              // Get audio duration using a safely constructed Audio element
              const duration = await getAudioDuration(audioUrl);

              // Store the duration in frames (30fps)
              const durationInFrames = Math.ceil(duration * 30);
              const key = `${verse.chapterId}:${verse.verseNumber}`;
              newDurations[key] = durationInFrames;

              prefetch(audioUrl);
            } catch (error) {
              console.error(`Error getting duration for verse ${verse.verseNumber}:`, error);
              // Use default duration for failed fetches (10 seconds)
              const key = `${verse.chapterId}:${verse.verseNumber}`;
              newDurations[key] = 300; // 10 seconds default

              // Still prefetch even if duration fetch fails
              prefetch(audioUrl);
            }
          }
        });

        await Promise.all(promises);
        setTranslationDurations(newDurations);
      };

      fetchDurations();
    }
  }, [verses, translationAudio, getTranslationAudioUrl]);

  // Fixed function using proper 'new Audio()' syntax
  const getAudioDuration = (audioUrl: string): Promise<number> => {
    return new Promise((resolve, reject) => {
      // Make sure we use 'new Audio()' properly
      const audio = new Audio();

      audio.addEventListener('loadedmetadata', () => {
        resolve(audio.duration);
      });

      audio.addEventListener('error', () => {
        reject(new Error(`Failed to load audio: ${audioUrl}`));
      });

      // Set crossOrigin if needed for CORS
      audio.crossOrigin = 'anonymous';
      audio.src = audioUrl;
      audio.load();
    });
  };

  // Handle custom uploaded videos (blob URLs or static file paths) vs predefined videos
  const isCustomVideo =
    video?.videoSrc?.startsWith('blob:') ||
    video?.isCustomVideo ||
    (video?.videoSrc && video.videoSrc.startsWith('/custom-videos/'));
  const videoPath = isCustomVideo
    ? // For blob URLs (player mode) use directly, for static paths (render mode) use staticFile
      video.videoSrc.startsWith('blob:')
      ? video.videoSrc
      : staticFile(video.videoSrc) // Use staticFile for paths in public directory
    : staticFile(`${isPlayer ? '/publicMin' : ''}${video?.videoSrc || ''}`);

  console.log(
    'MediaMakerContent - video:',
    video,
    'videoPath:',
    videoPath,
    'isCustomVideo:',
    isCustomVideo,
  );
  const isPortrait = orientation === Orientation.PORTRAIT;
  // Update the adjustedTimestamps calculation to use pre-calculated values when available

  const { adjustedTimestamps, totalDuration } = useMemo(() => {
    if (!timestamps || timestamps.length === 0) {
      return { adjustedTimestamps: [], totalDuration: 0 };
    }

    // Clone the timestamps
    const adjustedTimestamps = [...timestamps];

    // If timestamps already have urduDuration property (from render-local.js), use them directly
    if (
      (translationAudio === 'urdu' || translationAudio === 'urdu-only') &&
      timestamps[0]?.urduDuration !== undefined
    ) {
      console.log('Using pre-calculated timestamps from render script');
      // Timestamps are already adjusted, just calculate total duration
      const lastTimestamp = adjustedTimestamps[adjustedTimestamps.length - 1];
      if (translationAudio === 'urdu-only') {
        // Urdu-only mode: only use Urdu duration
        const lastVerseEnd = lastTimestamp.start + (lastTimestamp.urduDuration || 0);
        return {
          adjustedTimestamps,
          totalDuration: lastVerseEnd + 60,
        };
      }
      // Urdu mode: Arabic + buffer + Urdu
      const lastVerseEnd =
        lastTimestamp.start +
        lastTimestamp.durationInFrames +
        15 +
        (lastTimestamp.urduDuration || 0);
      return {
        adjustedTimestamps,
        totalDuration: lastVerseEnd + 60,
      };
    }

    // If Urdu-only mode is enabled, only play Urdu audio (no Arabic)
    if (translationAudio === 'urdu-only') {
      let currentPosition = 0;

      for (let i = 0; i < adjustedTimestamps.length; i++) {
        // Set the start position for this verse
        adjustedTimestamps[i] = {
          ...adjustedTimestamps[i],
          start: currentPosition,
        };

        // Get the actual Urdu translation duration or use default if not available
        const verse = verses[i];
        const verseKey = verse ? `${verse.chapterId}:${verse.verseNumber}` : '';
        const urduDuration = translationDurations[verseKey] || 300; // Default to 10 seconds if not found

        // Store urduDuration in timestamp
        adjustedTimestamps[i].urduDuration = urduDuration;
        adjustedTimestamps[i].urduStart = currentPosition; // Urdu starts immediately (no Arabic before it)

        console.log(`Player: Verse ${verseKey} - Urdu Only: ${urduDuration} frames`);

        // Move position forward with only Urdu duration (no Arabic, no buffer)
        currentPosition += urduDuration;
      }

      return {
        adjustedTimestamps,
        totalDuration: currentPosition + 60, // Add 2 seconds buffer at the end
      };
    }

    // If translation audio is enabled (urdu mode), adjust the timing structure
    if (translationAudio === 'urdu') {
      // Each verse will have its own Arabic + Urdu sequence
      let currentPosition = 0;

      for (let i = 0; i < adjustedTimestamps.length; i++) {
        // Set the start position for this verse
        adjustedTimestamps[i] = {
          ...adjustedTimestamps[i],
          start: currentPosition,
        };

        // The Arabic recitation duration
        const arabicDuration = adjustedTimestamps[i].durationInFrames;

        // Add buffer time between Arabic and Urdu (15 frames = 0.5 seconds)
        const bufferFrames = 15;

        // Get the actual Urdu translation duration or use default if not available
        const verse = verses[i];
        const verseKey = verse ? `${verse.chapterId}:${verse.verseNumber}` : '';
        const urduDuration = translationDurations[verseKey] || 300; // Default to 10 seconds if not found

        // Store urduDuration in timestamp for consistency
        adjustedTimestamps[i].urduDuration = urduDuration;
        adjustedTimestamps[i].urduStart = currentPosition + arabicDuration + bufferFrames;

        console.log(
          `Player: Verse ${verseKey} - Arabic: ${arabicDuration}, Urdu: ${urduDuration} frames`,
        );

        // Move position forward to include both Arabic and Urdu audio with buffer
        currentPosition += arabicDuration + bufferFrames + urduDuration;
      }

      return {
        adjustedTimestamps,
        totalDuration: currentPosition + 60, // Add 2 seconds buffer at the end
      };
    }

    // If no translation audio, preserve original behavior
    for (let i = 0; i < adjustedTimestamps.length; i++) {
      if (i === 0) {
        adjustedTimestamps[i].start = 0;
      } else {
        // Each verse starts right after the previous one
        const previousTimestamp = adjustedTimestamps[i - 1];
        adjustedTimestamps[i].start = previousTimestamp.start + previousTimestamp.durationInFrames;
      }
    }

    // Calculate total duration based on the last verse
    const lastTimestamp = adjustedTimestamps[adjustedTimestamps.length - 1];
    const totalDuration = lastTimestamp.start + lastTimestamp.durationInFrames + 30; // Add 1 second buffer at end

    return { adjustedTimestamps, totalDuration };
  }, [timestamps, translationAudio, verses, translationDurations]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
      }}
      translate="no"
    >
      <div className={styles.videoContainer}>
        <Video loop src={videoPath} muted />
      </div>

      {/* Render a single audio element for non-Urdu mode to maintain original smooth playback */}
      {audioHasStartAndEndRanges && translationAudio === 'none' && (
        <RemotionAudio
          pauseWhenBuffering
          startFrom={startFrom}
          endAt={endAt}
          src={audio.audioUrl}
          acceptableTimeShiftInSeconds={1}
        />
      )}

      {verses &&
        verses.length > 0 &&
        verses.map((verse: Verse, i) => {
          const chapter = getChapterData(
            chaptersDataArabic || (JSON.parse(JSON.stringify(defaultChaptersData)) as any),
            String(verse.chapterId),
          );

          if (!adjustedTimestamps[i]) return null;

          // Calculate durations for this verse
          const verseStartFrame = adjustedTimestamps[i].start;
          const arabicDuration = adjustedTimestamps[i].durationInFrames;

          // Buffer between Arabic and Urdu audio (15 frames = 0.5 seconds)
          const bufferDuration = 15;

          // Get the actual Urdu translation duration or use default if not available
          const verseKey = `${verse?.chapterId}:${verse?.verseNumber}`;
          const actualTranslationDuration =
            adjustedTimestamps[i]?.urduDuration || translationDurations[verseKey] || 300;

          // Total duration for this verse sequence
          let totalVerseDuration: number;
          let translationDuration: number;

          if (translationAudio === 'urdu-only') {
            // Urdu-only mode: only Urdu audio, no Arabic
            translationDuration = actualTranslationDuration;
            totalVerseDuration = translationDuration;
          } else if (translationAudio === 'urdu') {
            // Urdu mode: Arabic + buffer + Urdu
            translationDuration = actualTranslationDuration;
            totalVerseDuration = arabicDuration + bufferDuration + translationDuration;
          } else {
            // None mode: only Arabic
            translationDuration = 0;
            totalVerseDuration = arabicDuration;
          }

          // Get the specific verse timing from the audio data
          const verseTiming = audio?.verseTimings[i];
          const verseStartTime = verseTiming?.normalizedStart
            ? (verseTiming.normalizedStart / 1000) * 30
            : (verseTiming?.timestampFrom / 1000) * 30;

          const verseEndTime = verseTiming?.normalizedEnd
            ? (verseTiming.normalizedEnd / 1000) * 30
            : (verseTiming?.timestampTo / 1000) * 30;

          return (
            <Sequence
              key={`verse-${i}`}
              from={verseStartFrame}
              durationInFrames={totalVerseDuration}
            >
              {/* Visual content - the same for both Arabic and Urdu audio */}
              {(showLogo || showSurahInfo) && (
                <AbsoluteFill
                  style={{
                    height: '250px',
                    paddingTop: isPortrait ? 180 : 40,
                    backgroundImage: 'linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0))',
                  }}
                >
                  {showLogo && (
                    <div className={styles.chapterTitle}>
                      <div className={styles.chapterLogo}>
                        <span
                          className={classNames(styles.logo, {
                            [styles.logoPortrait]: isPortrait,
                            [styles.logoLandscape]: !isPortrait,
                          })}
                        >
                          Quran.com
                        </span>
                      </div>
                    </div>
                  )}
                  {showSurahInfo && (
                    <div className={styles.surahInfo}>
                      {verse.juzNumber && (
                        <span className={styles.juzNumber}>
                          {`الجزء ${toLocalizedNumber(verse.juzNumber, 'ar')}`}
                        </span>
                      )}

                      <span className={styles.surahArabic}>
                        {`${WORD_SURAH} ${chapter?.translatedName}`}
                      </span>
                      <span className={styles.surahNumber}>
                        {toLocalizedNumber(Number(verse.chapterId), 'ar')}
                      </span>
                    </div>
                  )}
                </AbsoluteFill>
              )}
              <AbsoluteFill
                style={{
                  backgroundColor: convertHexToRGBA(backgroundColor, Number(opacity)),
                  color: fontColor,
                  // @ts-ignore
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  '--border-size': `${borderSize}px`,
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  '--border-color': borderColor,
                }}
                className={classNames(styles.verseContainer, styles.verseBorder, {
                  [styles.verseLandscape]: !isPortrait,
                  [styles.versePortrait]: isPortrait,
                })}
              >
                {showArabic && (
                  <div
                    style={{
                      fontSize: quranTextFontScale * 10.1,
                    }}
                    className={classNames(styles.verseText, {
                      [styles.verseCentre]: verseAlignment === Alignment.CENTRE,
                      [styles.verseJustified]: verseAlignment === Alignment.JUSTIFIED,
                      [styles.indopakFont]: quranTextFontStyle === QuranFont.IndoPak,
                      [styles.uthmaniFont]: quranTextFontStyle === QuranFont.QPCHafs,
                    })}
                  >
                    {verse.words.map((word) => word.text).join(' ')}
                  </div>
                )}

                {verse.translations?.map((translation: Translation) => (
                  <div
                    key={translation.id}
                    className={classNames(styles.translation, {
                      [styles.verseTranslationCentre]: translationAlignment === Alignment.CENTRE,
                      [styles.verseTranslationJustified]:
                        translationAlignment === Alignment.JUSTIFIED,
                    })}
                  >
                    <div
                      style={{ fontSize: translationFontScale * 10.1 }}
                      dangerouslySetInnerHTML={{
                        __html: getPlainTranslationText(
                          `${translation.text} (${verse.chapterId}:${verse.verseNumber})`,
                        ),
                      }}
                    />
                  </div>
                ))}
              </AbsoluteFill>

              {/* Audio elements for Urdu translation modes */}
              {translationAudio === 'urdu-only' && (
                <>
                  {/* Urdu-only mode: Only Urdu audio, no Arabic */}
                  <Sequence from={0} durationInFrames={translationDuration}>
                    <RemotionAudio
                      pauseWhenBuffering
                      src={getTranslationAudioUrl(verse.chapterId, verse.verseNumber)}
                      acceptableTimeShiftInSeconds={1}
                    />
                  </Sequence>
                </>
              )}

              {translationAudio === 'urdu' && (
                <>
                  {/* Arabic Audio - plays first */}
                  <Sequence from={0} durationInFrames={arabicDuration}>
                    {audioHasStartAndEndRanges && verseTiming && (
                      <RemotionAudio
                        pauseWhenBuffering
                        src={audio.audioUrl}
                        startFrom={verseStartTime}
                        endAt={verseEndTime}
                        acceptableTimeShiftInSeconds={1}
                      />
                    )}
                  </Sequence>

                  {/* Urdu Translation Audio - plays after Arabic finishes with a small buffer */}
                  <Sequence
                    from={arabicDuration + bufferDuration}
                    durationInFrames={translationDuration}
                  >
                    <RemotionAudio
                      pauseWhenBuffering
                      src={getTranslationAudioUrl(verse.chapterId, verse.verseNumber)}
                      acceptableTimeShiftInSeconds={1}
                    />
                  </Sequence>
                </>
              )}
            </Sequence>
          );
        })}
    </AbsoluteFill>
  );
};

export default MediaMakerContent;
