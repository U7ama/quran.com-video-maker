import React from 'react';
import useTranslation from 'next-translate/useTranslation';
import styles from '../MediaMaker.module.scss';
import Switch, { SwitchSize } from '@/dls/Switch/Switch';
import { MediaSettingsProps } from '@/types/Media/MediaSettings';

export enum TranslationAudio {
  NONE = 'none',
  URDU = 'urdu',
  URDU_ONLY = 'urdu-only',
}

interface Props extends MediaSettingsProps {
  translationAudio: string;
}

const TranslationAudioSettings: React.FC<Props> = ({ onSettingsUpdate, translationAudio }) => {
  const { t } = useTranslation('media');

  const translationAudioOptions = [
    {
      name: t('translation-audio-none') || 'None',
      value: TranslationAudio.NONE,
    },
    {
      name: t('translation-audio-urdu') || 'Urdu',
      value: TranslationAudio.URDU,
    },
    {
      name: t('translation-audio-urdu-only') || 'Urdu Only',
      value: TranslationAudio.URDU_ONLY,
    },
  ];

  const onTranslationAudioChange = (value) => {
    onSettingsUpdate({ translationAudio: value }, 'translationAudio', value);
  };

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{t('translation-audio') || 'Translation Audio'}</div>
      <div className={styles.selectContainer}>
        <Switch
          size={SwitchSize.Small}
          selected={translationAudio || TranslationAudio.NONE} // Default to NONE if not set
          items={translationAudioOptions}
          onSelect={onTranslationAudioChange}
        />
      </div>
    </div>
  );
};

export default TranslationAudioSettings;
