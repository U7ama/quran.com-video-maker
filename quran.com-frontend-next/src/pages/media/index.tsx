/* eslint-disable max-lines */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Player, PlayerRef, RenderPoster } from '@remotion/player';
import classNames from 'classnames';
import { GetStaticProps, NextPage } from 'next';
import Image from 'next/image';
import { useRouter } from 'next/router';
import useTranslation from 'next-translate/useTranslation';
import { AbsoluteFill, cancelRender, prefetch, staticFile } from 'remotion';
import useSWRImmutable from 'swr/immutable';

import {
  getAvailableReciters,
  getAvailableTranslations,
  getChapterAudioData,
  getChapterVerses,
} from '@/api';
import PlayerContent from '@/components/MediaMaker/Content';
import LocalRenderButton from '@/components/MediaMaker/LocalRenderButton';
import styles from '@/components/MediaMaker/MediaMaker.module.scss';
import VideoSettings from '@/components/MediaMaker/Settings/VideoSettings';
import NextSeoWrapper from '@/components/NextSeoWrapper';
import Button, { ButtonType } from '@/dls/Button/Button';
import Spinner, { SpinnerSize } from '@/dls/Spinner/Spinner';
import { ToastStatus, useToast } from '@/dls/Toast/Toast';
import useGetMediaSettings from '@/hooks/auth/media/useGetMediaSettings';
import useAddQueryParamsToUrlSkipFirstRender from '@/hooks/useAddQueryParamsToUrlSkipFirstRender';
import VideoIcon from '@/icons/video.svg';
import { getMediaGeneratorOgImageUrl } from '@/lib/og';
import layoutStyles from '@/pages/index.module.scss';
import AudioData from '@/types/AudioData';
import Orientation from '@/types/Media/Orientation';
import PreviewMode from '@/types/Media/PreviewMode';
import QueryParam from '@/types/QueryParam';
import { MushafLines, QuranFont } from '@/types/QuranReader';
import Reciter from '@/types/Reciter';
import Translation from '@/types/Translation';
import { getMushafId } from '@/utils/api';
import { makeChapterAudioDataUrl, makeVersesUrl } from '@/utils/apiPaths';
import { areArraysEqual } from '@/utils/array';
import { getAllChaptersData, getChapterData } from '@/utils/chapter';
import { isChromeIOS, isSafari } from '@/utils/device-detector';
import { logButtonClick } from '@/utils/eventLogger';
import { getLanguageAlternates, toLocalizedNumber } from '@/utils/locale';
import {
  DEFAULT_API_PARAMS,
  DEFAULT_QURAN_FONT_STYLE,
  DEFAULT_RECITER_ID,
  DEFAULT_VIDEO_ID,
  DEFAULT_SURAH,
  DEFAULT_VERSE,
  VIDEO_FPS,
} from '@/utils/media/constants';
import {
  getBackgroundVideoById,
  getCurrentRangesAudioData,
  getDurationInFrames,
  getNormalizedTimestamps,
  orientationToDimensions,
} from '@/utils/media/utils';
import { getCanonicalUrl, getQuranMediaMakerNavigationUrl } from '@/utils/navigation';
import {
  ONE_MONTH_REVALIDATION_PERIOD_SECONDS,
  REVALIDATION_PERIOD_ON_ERROR_SECONDS,
} from '@/utils/staticPageGeneration';
import { isValidVerseFrom, isValidVerseKey, isValidVerseTo } from '@/utils/validator';
import { VersesResponse } from 'types/ApiResponses';
import ChaptersData from 'types/ChaptersData';

interface MediaMaker {
  juzVerses?: VersesResponse;
  reciters: Reciter[];
  translationsData: Translation[];
  verses: any;
  audio: any;
  chaptersData: ChaptersData;
  englishChaptersList: ChaptersData;
}

const MediaMaker: NextPage<MediaMaker> = ({
  chaptersData,
  englishChaptersList,
  reciters,
  verses: defaultVerses,
  audio: defaultAudio,
  translationsData,
}) => {
  const { t, lang } = useTranslation('common');
  const mediaSettings = useGetMediaSettings(reciters, translationsData);
  const [isReady, setIsReady] = useState(false);
  const [videoFileReady, setVideoFileReady] = useState(false);
  const [audioFileReady, setAudioFileReady] = useState(false);
  const TOAST_GENERAL_ERROR = t('common:error.general');
  const areMediaFilesReady = videoFileReady && audioFileReady;
  const [isRendering, setIsRendering] = useState(false);
  const [translationDurations, setTranslationDurations] = useState<Record<string, number>>({});
  const [isLoadingUrduDurations, setIsLoadingUrduDurations] = useState(false);
  const playerRef = useRef<PlayerRef>(null);

  const router = useRouter();

  useEffect(() => {
    setIsReady(true);
  }, []);

  const toast = useToast();
  const {
    surah,
    verseFrom,
    verseTo,
    reciter,
    translations,
    backgroundColor,
    opacity,
    borderColor,
    borderSize,
    fontColor,
    verseAlignment,
    translationAlignment,
    videoId,
    quranTextFontScale,
    quranTextFontStyle,
    translationFontScale,
    orientation,
    previewMode,
  } = mediaSettings;

  const queryParams = {
    [QueryParam.SURAH]: String(surah),
    [QueryParam.VERSE_FROM]: String(verseFrom),
    [QueryParam.VERSE_TO]: String(verseTo),
    [QueryParam.RECITER]: String(reciter),
    [QueryParam.MEDIA_TRANSLATIONS]: String(translations),
    [QueryParam.BACKGROUND_COLOR]: backgroundColor,
    [QueryParam.OPACITY]: String(opacity),
    [QueryParam.BORDER_COLOR]: borderColor,
    [QueryParam.BORDER_SIZE]: String(borderSize),
    [QueryParam.FONT_COLOR]: fontColor,
    [QueryParam.VIDEO_ID]: String(videoId),
    [QueryParam.QURAN_TEXT_FONT_SCALE]: String(quranTextFontScale),
    [QueryParam.QURAN_TEXT_FONT_STYLE]: String(quranTextFontStyle),
    [QueryParam.TRANSLATION_FONT_SCALE]: String(translationFontScale),
    [QueryParam.ORIENTATION]: orientation,
    [QueryParam.PREVIEW_MODE]: String(previewMode),
  };

  useAddQueryParamsToUrlSkipFirstRender(getQuranMediaMakerNavigationUrl(), queryParams);

  const API_PARAMS = useMemo(() => {
    return {
      ...DEFAULT_API_PARAMS,
      translations,
      from: `${surah}:${verseFrom}`,
      to: `${surah}:${verseTo}`,
      // the number of verses of the range
      perPage: Number(verseTo) - Number(verseFrom) + 1,
      mushaf: getMushafId(
        quranTextFontStyle,
        quranTextFontStyle === QuranFont.IndoPak ? MushafLines.SixteenLines : null,
      ).mushaf,
    };
  }, [quranTextFontStyle, surah, translations, verseFrom, verseTo]);

  const shouldRefetchVersesData = useMemo(() => {
    /**
     * Refetch data of the current verses If:
     *
     * 1. translations changed
     * 2. Range start Ayah changed
     * 3. Range end Ayah changed
     * 4. Reciter changes
     * 4. Font changes
     */
    return (
      !areArraysEqual(translations, DEFAULT_API_PARAMS.translations) ||
      verseFrom !== `${DEFAULT_SURAH}:${DEFAULT_VERSE}` ||
      verseTo !== `${DEFAULT_SURAH}:${DEFAULT_VERSE}` ||
      Number(reciter) !== DEFAULT_RECITER_ID ||
      quranTextFontStyle !== DEFAULT_QURAN_FONT_STYLE
    );
  }, [translations, verseFrom, verseTo, reciter, quranTextFontStyle]);

  const {
    data: verseData,
    isValidating: isVersesValidating,
    error: versesError,
  } = useSWRImmutable<VersesResponse>(
    makeVersesUrl(surah, lang, API_PARAMS),
    () => getChapterVerses(surah, lang, API_PARAMS),
    {
      fallbackData: defaultVerses,
      revalidateOnMount: shouldRefetchVersesData,
    },
  );
  // Refetch audio data if the reciter or chapter has changed
  const shouldRefetchAudioData =
    Number(reciter) !== DEFAULT_RECITER_ID || Number(surah) !== DEFAULT_SURAH;

  const {
    data: currentSurahAudioData,
    isValidating: isAudioValidating,
    error: audioError,
  } = useSWRImmutable<AudioData>(
    makeChapterAudioDataUrl(reciter, surah, true),
    () => getChapterAudioData(reciter, surah, true),
    {
      fallbackData: defaultAudio,
      // only revalidate when the reciter or chapter has changed
      revalidateOnMount: shouldRefetchAudioData,
    },
  );

  // listen for errors and show a toast
  useEffect(() => {
    if (versesError || audioError) {
      toast(TOAST_GENERAL_ERROR, {
        status: ToastStatus.Error,
      });
    }
  }, [versesError, audioError, toast, TOAST_GENERAL_ERROR]);

  const isFetching = isVersesValidating || isAudioValidating;
  const chapterEnglishName = useMemo<string>(() => {
    return englishChaptersList?.[surah]?.translatedName as string;
  }, [surah, englishChaptersList]);

  // Since we get the {{verseFrom}} and {{verseTo}} from the mediaSettings they will be available immediately,
  // however this is not the case for {{currentSurahAudioData}}, so we validate the verses against the surah from {{currentSurahAudioData}}
  // and return defaultAudio if it is not valid and return the surahAudio if they are valid.
  const audioData = useMemo(() => {
    const chapterId = String(currentSurahAudioData.chapterId);
    const startVerseKey = `${chapterId}:${verseFrom}`;
    const endVerseKey = `${chapterId}:${verseTo}`;
    const isValidAudioVerseFromKey = isValidVerseKey(chaptersData, startVerseKey);
    const isValidAudioVerseToKey = isValidVerseKey(chaptersData, endVerseKey);

    if (!isValidAudioVerseFromKey || !isValidAudioVerseToKey) {
      return defaultAudio;
    }

    const chapterData = getChapterData(chaptersData, chapterId);
    const isValidAudioVerses =
      isValidVerseFrom(startVerseKey, endVerseKey, chapterData.versesCount, chapterId) &&
      isValidVerseTo(startVerseKey, endVerseKey, chapterData.versesCount, chapterId);

    if (!isValidAudioVerses) {
      return defaultAudio;
    }

    return getCurrentRangesAudioData(currentSurahAudioData, Number(verseFrom), Number(verseTo));
  }, [chaptersData, currentSurahAudioData, defaultAudio, verseFrom, verseTo]);

  const timestamps = useMemo(() => {
    return getNormalizedTimestamps(audioData, VIDEO_FPS);
  }, [audioData]);

  // Update the useEffect to fetch Urdu audio durations WITH loading state
  useEffect(() => {
    if (
      (mediaSettings.translationAudio === 'urdu' ||
        mediaSettings.translationAudio === 'urdu-only') &&
      verseData?.verses &&
      verseData.verses.length > 0
    ) {
      setIsLoadingUrduDurations(true);

      const fetchDurations = async () => {
        const newDurations: Record<string, number> = {};

        // Fetch all durations in parallel for better performance
        const promises = verseData.verses.map(async (verse) => {
          const paddedChapter = String(verse.chapterId).padStart(3, '0');
          const paddedVerse = String(verse.verseNumber).padStart(3, '0');
          const audioUrl = `https://everyayah.com/data/translations/urdu_shamshad_ali_khan_46kbps/${paddedChapter}${paddedVerse}.mp3`;

          try {
            const audio = new Audio();
            const duration = await new Promise<number>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Timeout'));
              }, 10000); // 10 second timeout

              audio.addEventListener('loadedmetadata', () => {
                clearTimeout(timeout);
                resolve(audio.duration);
              });
              audio.addEventListener('error', () => {
                clearTimeout(timeout);
                reject(new Error('Failed to load'));
              });
              audio.crossOrigin = 'anonymous';
              audio.src = audioUrl;
              audio.load();
            });

            const durationInFrames = Math.ceil(duration * 30);
            const key = `${verse.chapterId}:${verse.verseNumber}`;
            newDurations[key] = durationInFrames;
            console.log(
              `Fetched Urdu duration for ${key}: ${durationInFrames} frames (${duration.toFixed(
                2,
              )}s)`,
            );
          } catch (error) {
            console.error(`Error getting duration for verse ${verse.verseNumber}:`, error);
            const key = `${verse.chapterId}:${verse.verseNumber}`;
            newDurations[key] = 300; // 10 seconds default
            console.warn(`Using default duration for ${key}: 300 frames`);
          }
        });

        await Promise.all(promises);

        console.log('All Urdu durations fetched:', newDurations);
        setTranslationDurations(newDurations);
        setIsLoadingUrduDurations(false);
      };

      fetchDurations();
    } else {
      // Clear durations if Urdu is not selected
      setTranslationDurations({});
      setIsLoadingUrduDurations(false);
    }
  }, [mediaSettings.translationAudio, verseData?.verses]);

  // IMPORTANT: Only calculate adjusted timestamps AFTER durations are loaded
  const adjustedTimestamps = useMemo(() => {
    if (!timestamps || timestamps.length === 0) {
      return timestamps;
    }

    if (
      mediaSettings.translationAudio !== 'urdu' &&
      mediaSettings.translationAudio !== 'urdu-only'
    ) {
      return timestamps;
    }

    // If we're still loading durations, return original timestamps
    // This prevents calculating with empty durations
    if (isLoadingUrduDurations) {
      console.log('Still loading Urdu durations, using original timestamps');
      return timestamps;
    }

    const isUrduOnly = mediaSettings.translationAudio === 'urdu-only';

    // Adjust timestamps to include Urdu durations
    let currentPosition = 0;
    const adjusted = [];
    const bufferFrames = 15; // 0.5 seconds buffer at 30fps

    for (let i = 0; i < timestamps.length; i++) {
      const originalTimestamp = timestamps[i];
      const arabicDuration = originalTimestamp.durationInFrames;

      // Get the actual Urdu duration for this verse
      const verse = verseData.verses[i];
      const verseKey = `${verse?.chapterId}:${verse?.verseNumber}`;
      const urduDuration = translationDurations[verseKey];

      if (!urduDuration) {
        console.warn(`Missing Urdu duration for ${verseKey}, durations:`, translationDurations);
      }

      const actualUrduDuration = urduDuration || 300;

      if (isUrduOnly) {
        // Urdu-only mode: only Urdu audio, no Arabic, no buffer
        console.log(`Adjusting timestamp for ${verseKey} [Urdu-only]: Urdu=${actualUrduDuration}`);

        adjusted.push({
          ...originalTimestamp,
          start: currentPosition,
          urduStart: currentPosition, // Urdu starts immediately (no Arabic before it)
          urduDuration: actualUrduDuration,
        });

        // Move position forward: Only Urdu (no Arabic, no buffer)
        currentPosition += actualUrduDuration;
      } else {
        // Urdu mode: Arabic + buffer + Urdu
        console.log(
          `Adjusting timestamp for ${verseKey}: Arabic=${arabicDuration}, Urdu=${actualUrduDuration}`,
        );

        adjusted.push({
          ...originalTimestamp,
          start: currentPosition,
          end: currentPosition + arabicDuration,
          urduStart: currentPosition + arabicDuration + bufferFrames,
          urduDuration: actualUrduDuration,
        });

        // Move position forward: Arabic + buffer + Urdu
        currentPosition += arabicDuration + bufferFrames + actualUrduDuration;
      }
    }

    console.log('Adjusted timestamps for render:', adjusted);
    return adjusted;
  }, [
    timestamps,
    mediaSettings.translationAudio,
    verseData.verses,
    translationDurations,
    isLoadingUrduDurations,
  ]);

  const durationInFrames = useMemo(() => {
    return getDurationInFrames(adjustedTimestamps, mediaSettings.translationAudio);
  }, [adjustedTimestamps, mediaSettings.translationAudio]);

  useEffect(() => {
    if (Object.keys(translationDurations).length > 0) {
      console.log('Translation durations updated:', translationDurations);
      console.log('Adjusted timestamps after duration update:', adjustedTimestamps);
    }
  }, [translationDurations, adjustedTimestamps]);

  const inputProps = useMemo(() => {
    return {
      verses: verseData.verses,
      audio: audioData,
      timestamps: adjustedTimestamps,
      backgroundColor,
      opacity,
      borderColor,
      borderSize,
      fontColor,
      verseAlignment,
      translationAlignment,
      video: (() => {
        if (mediaSettings.customVideoUrl) {
          console.log('Using custom video:', mediaSettings.customVideoUrl);
          // For custom videos, use a default watermark color
          const defaultVideo = getBackgroundVideoById(DEFAULT_VIDEO_ID);
          return {
            videoSrc: mediaSettings.customVideoUrl,
            thumbnailSrc: '',
            watermarkColor: defaultVideo?.watermarkColor || 'light',
          };
        }
        const defaultVideo = getBackgroundVideoById(videoId);
        // Fallback to default video if videoId is invalid
        const video = defaultVideo || getBackgroundVideoById(DEFAULT_VIDEO_ID);
        console.log('Using predefined video:', video?.videoSrc);
        return video;
      })(),
      quranTextFontScale,
      quranTextFontStyle,
      translationFontScale,
      orientation,
      videoId,
      customVideoUrl: mediaSettings.customVideoUrl,
      chapterEnglishName,
      isPlayer: true,
      translations,
      translationAudio: mediaSettings.translationAudio || 'none',
      translationDurations, // This will now have the actual values
      previewMode,
      durationInFrames,
      showArabic: mediaSettings.showArabic ?? true,
      showLogo: mediaSettings.showLogo ?? true,
      showSurahInfo: mediaSettings.showSurahInfo ?? true,
    };
  }, [
    verseData.verses,
    translations,
    audioData,
    adjustedTimestamps,
    backgroundColor,
    opacity,
    borderColor,
    borderSize,
    fontColor,
    verseAlignment,
    translationAlignment,
    videoId,
    quranTextFontScale,
    quranTextFontStyle,
    translationFontScale,
    orientation,
    chapterEnglishName,
    mediaSettings.translationAudio,
    translationDurations,
    previewMode,
    durationInFrames,
    mediaSettings.customVideoUrl,
    mediaSettings.showArabic,
    mediaSettings.showLogo,
    mediaSettings.showSurahInfo,
  ]);
  /**
   * Disables preview mode by setting the preview_mode URL parameter to disabled
   */
  const disablePreviewMode = () => {
    logButtonClick('video_generation_disable_preview');

    const newQuery = { ...router.query };
    newQuery[QueryParam.PREVIEW_MODE] = PreviewMode.DISABLED;

    router.push(
      {
        pathname: router.pathname,
        query: newQuery,
      },
      undefined,
      { shallow: true },
    );
  };

  const method = isChromeIOS() ? 'base64' : 'blob-url';
  useEffect(() => {
    if (!inputProps.video?.videoSrc) {
      return;
    }

    // Handle custom videos (blob URLs) vs predefined videos
    const isCustomVideo = inputProps.video.videoSrc.startsWith('blob:');

    // Blob URLs don't need prefetching - they're already in memory
    // But we should wait a bit to ensure the blob URL is ready
    if (isCustomVideo) {
      // Small delay to ensure blob URL is ready
      setTimeout(() => {
        setVideoFileReady(true);
      }, 100);
      return;
    }

    setVideoFileReady(false);
    const videoPath = staticFile(`/publicMin${inputProps.video.videoSrc}`);

    // {@see https://www.remotion.dev/docs/troubleshooting/player-flicker#option-6-prefetching-as-base64-to-avoid-network-request-and-local-http-server}
    const { waitUntilDone: waitUntilVideoDone } = prefetch(videoPath, { method });

    waitUntilVideoDone()
      .then(() => {
        setVideoFileReady(true);
      })
      .catch((e) => {
        toast(TOAST_GENERAL_ERROR, {
          status: ToastStatus.Error,
        });
        cancelRender(e);
      });
  }, [inputProps.video?.videoSrc, toast, TOAST_GENERAL_ERROR, method]);

  useEffect(() => {
    if (inputProps.audio.audioUrl !== defaultAudio.audioUrl || !shouldRefetchAudioData) {
      setAudioFileReady(false);
      // {@see https://www.remotion.dev/docs/troubleshooting/player-flicker#option-6-prefetching-as-base64-to-avoid-network-request-and-local-http-server}
      const { waitUntilDone: waitUntilAudioDone } = prefetch(inputProps.audio.audioUrl, {
        method,
      });

      waitUntilAudioDone()
        .then(() => {
          setAudioFileReady(true);
        })
        .catch((e) => {
          toast(TOAST_GENERAL_ERROR, {
            status: ToastStatus.Error,
          });
          cancelRender(e);
        });
    }
  }, [
    inputProps.audio.audioUrl,
    toast,
    TOAST_GENERAL_ERROR,
    defaultAudio.audioUrl,
    audioData.audioUrl,
    shouldRefetchAudioData,
    method,
  ]);

  const renderPoster: RenderPoster = useCallback(() => {
    // Use video from inputProps to handle both custom and predefined videos
    const video = inputProps.video;

    if (isFetching || !areMediaFilesReady) {
      return (
        <div className={styles.loadingContainer}>
          <Spinner className={styles.spinner} size={SpinnerSize.Large} />
        </div>
      );
    }

    // If no video or no thumbnail, return empty poster
    if (!video || !video.thumbnailSrc) {
      return null;
    }

    return (
      <AbsoluteFill>
        <Image
          key={videoId}
          alt={videoId.toString()}
          className={classNames(styles.img)}
          src={video.thumbnailSrc}
          layout="fill"
          style={{ zIndex: -1 }}
        />
      </AbsoluteFill>
    );
  }, [areMediaFilesReady, isFetching, videoId, inputProps.video]);

  const chaptersList = useMemo(() => {
    return Object.entries(chaptersData).map(([id, chapterObj], index) => ({
      id,
      label: `${chapterObj.transliteratedName} (${toLocalizedNumber(index + 1, lang)})`,
      value: id,
      name: chapterObj.transliteratedName,
    }));
  }, [chaptersData, lang]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    if (previewMode === PreviewMode.ENABLED && playerRef.current) {
      timeoutId = setTimeout(() => {
        playerRef.current?.play();
        playerRef.current?.mute();
      }, 100);
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [previewMode]);

  const { width, height } = orientationToDimensions(orientation);
  const PATH = getQuranMediaMakerNavigationUrl();

  const SEOComponent = (
    <NextSeoWrapper
      title={t('media:maker-title')}
      description={t('media:maker-meta-desc')}
      url={getCanonicalUrl(lang, PATH)}
      languageAlternates={getLanguageAlternates(PATH)}
      image={getMediaGeneratorOgImageUrl({
        locale: lang,
      })}
      imageWidth={1200}
      imageHeight={630}
    />
  );

  if (!isReady) {
    return <>{SEOComponent}</>;
  }

  const isPreviewMode = previewMode === PreviewMode.ENABLED;

  return (
    <>
      {SEOComponent}
      <div className={styles.pageContainer}>
        {!isPreviewMode && (
          <div className={styles.titleContainer}>
            <h1>{t('media:title')}</h1>
          </div>
        )}
        <div
          className={classNames(styles.playerWrapper, layoutStyles.flowItem, {
            [styles.portraitAspectRatio]: orientation === Orientation.PORTRAIT,
          })}
        >
          <>
            <Player
              key={`player-${previewMode}-${mediaSettings.translationAudio}-${
                mediaSettings.customVideoUrl || videoId
              }`}
              ref={playerRef}
              className={classNames(styles.player, {
                [styles.playerHeightSafari]: isSafari(),
                [styles.playerHeight]: !isSafari(),
              })}
              inputProps={inputProps}
              component={PlayerContent}
              durationInFrames={durationInFrames}
              compositionWidth={width}
              compositionHeight={height}
              allowFullscreen
              doubleClickToFullscreen
              fps={VIDEO_FPS}
              controls={!isFetching && areMediaFilesReady}
              bufferStateDelayInMilliseconds={200}
              renderPoster={renderPoster}
              posterFillMode="player-size"
              showPosterWhenUnplayed
              showPosterWhenPaused
              showPosterWhenBuffering
              showPosterWhenEnded
              numberOfSharedAudioTags={10}
            />
          </>
        </div>
        {isPreviewMode ? (
          <>
            <div className={layoutStyles.additionalVerticalGapLarge} />

            <Button
              className={styles.generateVideoButton}
              type={ButtonType.Primary}
              prefix={<VideoIcon />}
              onClick={(e) => {
                e.stopPropagation();
                disablePreviewMode();
              }}
            >
              {t('media:generate-your-video')}
            </Button>
          </>
        ) : (
          <div className={layoutStyles.flow}>
            <div className={layoutStyles.additionalVerticalGapNew}>
              <LocalRenderButton
                inputProps={inputProps}
                className={styles.renderButton}
                isLoadingUrduDurations={isLoadingUrduDurations}
              />
            </div>
            <VideoSettings
              chaptersList={chaptersList}
              reciters={reciters}
              playerRef={playerRef}
              isFetching={isFetching}
              inputProps={inputProps}
              mediaSettings={mediaSettings}
            />
          </div>
        )}
      </div>
    </>
  );
};

const fetchRecitersAndTranslations = async (locale) => {
  const { reciters } = await getAvailableReciters(locale, []);
  const { translations } = await getAvailableTranslations(locale);
  return { reciters, translations };
};

const fetchChapterData = async (locale) => {
  const chaptersData = await getAllChaptersData(locale);
  const englishChaptersList = await getAllChaptersData('en');
  return { chaptersData, englishChaptersList };
};

const fetchVersesAndAudio = async (locale) => {
  const verses = await getChapterVerses(DEFAULT_SURAH, locale, DEFAULT_API_PARAMS);
  const chapterAudioData = await getChapterAudioData(DEFAULT_RECITER_ID, DEFAULT_SURAH, true);
  return { verses, chapterAudioData };
};

export const getStaticProps: GetStaticProps = async ({ locale }) => {
  try {
    const { reciters, translations } = await fetchRecitersAndTranslations(locale);
    const { chaptersData, englishChaptersList } = await fetchChapterData(locale);
    const { verses, chapterAudioData } = await fetchVersesAndAudio(locale);

    return {
      props: {
        audio: chapterAudioData,
        verses,
        chaptersData,
        englishChaptersList,
        reciters: reciters || [],
        translationsData: translations || [],
      },
      revalidate: ONE_MONTH_REVALIDATION_PERIOD_SECONDS,
    };
  } catch (e) {
    return {
      notFound: true,
      revalidate: REVALIDATION_PERIOD_ON_ERROR_SECONDS,
    };
  }
};

export default MediaMaker;
