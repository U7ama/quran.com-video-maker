export enum QuranFont {
  MadaniV1 = 'code_v1',
  MadaniV2 = 'code_v2', 
  Uthmani = 'text_uthmani',
  UthmaniTajweed = 'text_uthmani_tajweed',
  IndoPak = 'text_indopak',
  QPCHafs = 'qpc_uthmani_hafs',
}

export enum ReadingPreference {
  Translation = 'translation',
  Reading = 'reading',
}

export enum WordByWordType {
  Translation = 'translation',
  Transliteration = 'transliteration',
}

export enum WordClickFunctionality {
  PlayAudio = 'play-audio',
  ShowTooltip = 'show-tooltip',
  NoAudio = 'no-audio',
}

export enum TafsirContentType {
  Text = 'text',
  Video = 'video',
}

export enum QuranReaderDataType {
  Chapter = 'chapter',
  Verse = 'verse', 
  Juz = 'juz',
  Page = 'page',
  Hizb = 'hizb',
  RubElHizb = 'rub-el-hizb',
  Ruku = 'ruku',
}

export default QuranFont;
