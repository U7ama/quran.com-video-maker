import { useRef, useState } from 'react';

import useTranslation from 'next-translate/useTranslation';

import styles from '../MediaMaker.module.scss';

import Button, { ButtonType } from '@/dls/Button/Button';
import { MediaSettingsProps } from '@/types/Media/MediaSettings';

interface Props extends MediaSettingsProps {
  customVideoUrl?: string;
}

const VideoUpload: React.FC<Props> = ({ onSettingsUpdate, customVideoUrl }) => {
  const { t } = useTranslation('media');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('video/')) {
      alert(t('video-upload-invalid-type') || 'Please select a valid video file');
      return;
    }

    // Validate file size (max 100MB)
    const maxSize = 100 * 1024 * 1024; // 100MB in bytes
    if (file.size > maxSize) {
      alert(t('video-upload-too-large') || 'Video file is too large. Maximum size is 100MB');
      return;
    }

    setIsUploading(true);
    setUploadedFileName(file.name);

    try {
      // Create a blob URL from the file
      const videoUrl = URL.createObjectURL(file);
      console.log('Video uploaded, blob URL created:', videoUrl);

      // Update settings with the custom video URL
      // Set videoId to 0 to indicate custom video is being used
      onSettingsUpdate({ customVideoUrl: videoUrl, videoId: 0 }, 'customVideoUrl', videoUrl);
      console.log('Settings updated with customVideoUrl:', videoUrl);
    } catch (error) {
      console.error('Error uploading video:', error);
      alert(t('video-upload-error') || 'Error uploading video. Please try again.');
      setUploadedFileName(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveVideo = () => {
    if (customVideoUrl) {
      // Revoke the blob URL to free memory
      URL.revokeObjectURL(customVideoUrl);
    }
    onSettingsUpdate({ customVideoUrl: undefined, videoId: 1 }, 'customVideoUrl', undefined);
    setUploadedFileName(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className={styles.videoUploadContainer}>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
      {customVideoUrl ? (
        <div className={styles.uploadedVideoInfo}>
          <div className={styles.uploadedVideoName}>
            {uploadedFileName
              ? uploadedFileName.substring(0, 5)
              : t('video-upload-custom') || 'Custom Video'}
          </div>
          <Button type={ButtonType.Secondary} onClick={handleRemoveVideo}>
            {t('video-upload-remove') || 'Remove'}
          </Button>
        </div>
      ) : (
        <Button
          type={ButtonType.Secondary}
          onClick={handleUploadClick}
          disabled={isUploading}
          isLoading={isUploading}
        >
          {isUploading
            ? t('video-upload-uploading') || 'Uploading...'
            : t('video-upload-button') || 'Upload Video'}
        </Button>
      )}
    </div>
  );
};

export default VideoUpload;
