import React, { useState, useCallback } from 'react';

import { PlayerRef } from '@remotion/player';
import useTranslation from 'next-translate/useTranslation';

import Button, { ButtonType } from '@/dls/Button/Button';
import Spinner, { SpinnerSize } from '@/dls/Spinner/Spinner';
import { ToastStatus, useToast } from '@/dls/Toast/Toast';
import DownloadIcon from '@/icons/download.svg';
import { logButtonClick } from '@/utils/eventLogger';

interface DownloadButtonProps {
  playerRef: React.RefObject<PlayerRef>;
  isDisabled?: boolean;
}

const DownloadButton: React.FC<DownloadButtonProps> = ({ playerRef, isDisabled = false }) => {
  const { t } = useTranslation('media');
  const [isDownloading, setIsDownloading] = useState(false);
  const toast = useToast();

  const handleDownload = useCallback(async () => {
    if (!playerRef.current) {
      toast(t('download-error'), { status: ToastStatus.Error });
      return;
    }

    logButtonClick('video_download_button');
    setIsDownloading(true);

    try {
      // Get the currently rendered frame as a screenshot
      const blob: any = await playerRef.current.getCurrentFrame();

      // Create a timestamp for unique filename
      const timestamp = new Date().getTime();
      const fileName = `quran-verse-${timestamp}.png`;

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast(t('download-success'), { status: ToastStatus.Success });
    } catch (error) {
      console.error('Error downloading frame:', error);
      toast(t('download-error'), { status: ToastStatus.Error });
    } finally {
      setIsDownloading(false);
    }
  }, [playerRef, toast, t]);

  return (
    <Button
      type={ButtonType.Secondary}
      prefix={isDownloading ? <Spinner size={SpinnerSize.Small} /> : <DownloadIcon />}
      onClick={handleDownload}
      isDisabled={isDownloading || isDisabled}
    >
      {isDownloading ? t('downloading') : t('download-image')}
    </Button>
  );
};

export default DownloadButton;
