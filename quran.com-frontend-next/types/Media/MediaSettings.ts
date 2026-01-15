import { QuranFont } from '../QuranReader';

import Alignment from '@/types/Media/Alignment';
import Orientation from '@/types/Media/Orientation';
import PreviewMode from '@/types/Media/PreviewMode';

type MediaSettings = {
  verseTo: string;
  verseFrom: string;
  borderSize: number;
  borderColor: string;
  backgroundColor: string;
  opacity: number;
  reciter: number;
  quranTextFontScale: number;
  translationFontScale: number;
  quranTextFontStyle: QuranFont;
  translations: number[];
  fontColor: string;
  verseAlignment: Alignment;
  translationAlignment: Alignment;
  orientation: Orientation;
  videoId: number;
  customVideoUrl?: string;
  surah: number;
  translationAudio: string;
  previewMode: PreviewMode;
  showArabic: boolean;
  showLogo: boolean;
  showSurahInfo: boolean;
};

export type ChangedSettings = {
  [K in keyof MediaSettings]?: MediaSettings[K];
};

export interface MediaSettingsProps {
  onSettingsUpdate: (settings: ChangedSettings, key: keyof MediaSettings, value: any) => void;
}

export default MediaSettings;
