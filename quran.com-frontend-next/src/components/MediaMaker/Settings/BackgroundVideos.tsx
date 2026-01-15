import { useState } from 'react';

import classNames from 'classnames';
import Image from 'next/image';

import styles from '../MediaMaker.module.scss';

import { MediaSettingsProps } from '@/types/Media/MediaSettings';
import { getVideosArray } from '@/utils/media/utils';

const videos = getVideosArray();

interface Props extends MediaSettingsProps {
  videoId: number;
  customVideoUrl?: string;
}

const BackgroundVideos: React.FC<Props> = ({ onSettingsUpdate, videoId, customVideoUrl }) => {
  const [selectedVideoId, setSelectedVideoId] = useState(videoId);

  const onVideoSelected = (newVideId: number) => {
    setSelectedVideoId(newVideId);
    // Clear custom video when selecting a predefined video
    if (customVideoUrl) {
      URL.revokeObjectURL(customVideoUrl);
      onSettingsUpdate({ videoId: newVideId, customVideoUrl: undefined }, 'videoId', newVideId);
    } else {
      onSettingsUpdate({ videoId: newVideId }, 'videoId', newVideId);
    }
  };

  return (
    <div className={styles.BackgroundVideosWrapper}>
      {videos.map((video) => (
        <Image
          alt={video.id}
          key={video.id}
          className={classNames(styles.img, {
            [styles.selectedSetting]: video.id === selectedVideoId && !customVideoUrl,
            [styles.disabledSetting]: !!customVideoUrl,
          })}
          onClick={() => {
            if (!customVideoUrl) {
              onVideoSelected(video.id);
            }
          }}
          src={video.thumbnailSrc}
          width="100"
          height="100"
        />
      ))}
    </div>
  );
};

export default BackgroundVideos;
