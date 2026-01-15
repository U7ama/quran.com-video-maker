import { FC, useState, useEffect } from 'react';

import useTranslation from 'next-translate/useTranslation';

import Button, { ButtonType } from '@/dls/Button/Button';
import Spinner, { SpinnerSize } from '@/dls/Spinner/Spinner';
import { ToastStatus, useToast } from '@/dls/Toast/Toast';
import VideoIcon from '@/icons/video.svg';
import useGetChaptersData from '@/hooks/useGetChaptersData';
import { getChapterData } from '@/utils/chapter';
import defaultChaptersData from '@/utils/media/defaultChaptersData.json';
import { getReciterData } from '@/api';

interface LocalRenderButtonProps {
  inputProps: any;
  isLoadingUrduDurations: boolean;
  className?: string;
}

const WORD_SURAH = 'سُورَة';

const LocalRenderButton: FC<LocalRenderButtonProps> = ({
  inputProps,
  className,
  isLoadingUrduDurations = false,
}) => {
  const { t } = useTranslation('media');
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const toast = useToast();
  console.log('isLoadingUrduDurations', isLoadingUrduDurations);
  // Get chapters data in Arabic
  const chaptersDataArabic = useGetChaptersData('ar');

  // Generate the filename according to the required format
  const generateFileName = async () => {
    if (!inputProps || !inputProps.verses || inputProps.verses.length === 0) {
      return 'quran-video.mp4';
    }

    // Pad numbers with leading zeros for proper sorting
    const surahNumber = String(inputProps.verses[0].chapterId).padStart(3, '0');
    const fromAyah = String(inputProps.verses[0].verseNumber).padStart(3, '0');
    const toAyah = String(inputProps.verses[inputProps.verses.length - 1].verseNumber).padStart(
      3,
      '0',
    );
    const parahNumber = String(inputProps.verses[0].juzNumber).padStart(2, '0');

    // Add current date and time in UTC
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    const dateTimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

    // User login
    const userLogin = 'Ha7him123';

    // Get translator names
    const translatorNames = [];
    if (inputProps.verses[0].translations && inputProps.verses[0].translations.length > 0) {
      inputProps.verses[0].translations.forEach((translation) => {
        if (translation.resourceName) {
          // Remove spaces and special characters for filename compatibility
          const cleanName = translation.resourceName.replace(/[\s.]/g, '-');
          translatorNames.push(cleanName);
        }
      });
    }

    const translatorString = translatorNames.length > 0 ? `Trans-${translatorNames.join('-')}` : '';

    // Get the chapter data
    const chapter = getChapterData(
      chaptersDataArabic || (JSON.parse(JSON.stringify(defaultChaptersData)) as any),
      String(inputProps.verses[0].chapterId),
    );

    // Format the Surah name in Arabic
    const surahNameArabic = chapter?.translatedName
      ? `${WORD_SURAH} ${chapter.translatedName}`
      : '';

    // Get reciter data with error handling
    let reciterName = '';
    try {
      const reciterData = await getReciterData(inputProps.audio?.reciterId, 'ur');
      reciterName = reciterData?.reciter?.name || `Reciter-${inputProps.audio?.reciterId}`;
    } catch (error) {
      console.error('Error fetching reciter data:', error);
      reciterName = `Reciter-${inputProps.audio?.reciterId}`;
    }

    // Format: Surah-XXX-Ayah-YYY:ZZZ-Parah-PP-[ReciterInfo]-[TranslatorInfo]-SurahNameInArabic-[DateTime]
    return `Surah-${surahNumber}-Ayah-${fromAyah}:${toAyah}-Parah-${parahNumber}-Audio-${reciterName}-${translatorString}-${surahNameArabic}`;
  };

  const handleLocalRender = async () => {
    if (inputProps.translationAudio === 'urdu' || inputProps.translationAudio === 'urdu-only') {
      // Verify that we have durations for all verses
      const missingDurations = inputProps.verses.filter((verse) => {
        const key = `${verse.chapterId}:${verse.verseNumber}`;
        return !inputProps.translationDurations || !inputProps.translationDurations[key];
      });

      if (missingDurations.length > 0) {
        console.error('Missing Urdu durations for verses:', missingDurations);
        toast('Urdu audio durations are still loading. Please wait a moment and try again.', {
          status: ToastStatus.Warning,
        });
        return;
      }

      console.log('All Urdu durations available:', inputProps.translationDurations);
    }

    setIsRendering(true);
    setProgress(0);

    try {
      const requestId = `test-${Date.now()}`;
      let timeoutId: NodeJS.Timeout | null = null;

      // Calculate durationInFrames if timestamps exist
      let durationInFrames = 300; // Default 10 seconds at 30fps
      if (inputProps.timestamps && inputProps.timestamps.length > 0) {
        const frames = inputProps.timestamps.map((t) => Number(t.frame || 0));
        const maxFrame = Math.max(...frames);
        durationInFrames = Math.round(maxFrame + 60); // Add 2 seconds buffer
      }

      // Ensure translations are strings
      const translations = inputProps.translations
        ? inputProps.translations.map((t) => t.toString())
        : ['84']; // Default translation if none provided

      // Convert blob URL to base64 if it's a custom video
      let videoData = null;
      if (inputProps.video?.videoSrc?.startsWith('blob:')) {
        try {
          const response = await fetch(inputProps.video.videoSrc);
          const blob = await response.blob();
          const reader = new FileReader();
          videoData = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => {
              const base64String = reader.result as string;
              resolve(base64String);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          console.log('Converted blob URL to base64, size:', videoData.length);
        } catch (error) {
          console.error('Failed to convert blob URL to base64:', error);
          toast('Failed to process uploaded video. Please try again.', {
            status: ToastStatus.Error,
          });
          setIsRendering(false);
          return;
        }
      }

      // Prepare the request data with all required fields and proper values
      const requestData: any = {
        ...inputProps,
        translations, // Use the string array
        requestId,
        durationInFrames, // Explicit duration
        fps: 30, // Explicit fps
        isPlayer: false, // Rendering mode, not player mode
        translationAudio: inputProps.translationAudio || 'none',
        audio: inputProps.audio
          ? {
              ...inputProps.audio,
              // Make sure audioStatus is LOADED
              audioStatus: 'LOADED',
            }
          : undefined,
      };

      // Only include customVideoData if we have video data (not null/undefined)
      if (videoData) {
        requestData.customVideoData = videoData;
      }
      console.log('Sending timestamps to render:', inputProps.timestamps);
      // Start the render process
      const promise = fetch('/api/render/local', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });

      const response = await promise;
      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || `HTTP error! status: ${response.status}`);
      }

      // Get the video blob
      const videoBlob = await response.blob();

      // Create a download link with the proper filename - NOTE THE AWAIT HERE
      const filename = await generateFileName();
      const url = window.URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.mp4`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast(t('video-rendered-successfully') || 'Video rendered successfully!', {
        status: ToastStatus.Success,
      });
    } catch (error) {
      console.error('Local rendering failed:', error);
      toast(t('video-render-failed') || 'Failed to render video. Please try again.', {
        status: ToastStatus.Error,
      });
    } finally {
      setIsRendering(false);
      setProgress(0);
    }
  };

  return (
    <div>
      <Button
        className={className}
        type={ButtonType.Primary}
        prefix={isRendering ? <Spinner size={SpinnerSize.Small} /> : <VideoIcon />}
        onClick={handleLocalRender}
        isDisabled={isRendering || isLoadingUrduDurations}
      >
        {isRendering
          ? `Rendering Video... ${progress}%`
          : isLoadingUrduDurations
          ? 'Loading audio...'
          : 'Render Video Locally'}
      </Button>
    </div>
  );
};

export default LocalRenderButton;
