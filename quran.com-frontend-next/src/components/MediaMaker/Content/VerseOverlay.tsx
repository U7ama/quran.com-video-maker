import React from 'react';
import classNames from 'classnames';
import { AbsoluteFill } from 'remotion';
import styles from './MediaMakerContent.module.scss';
import { QuranFont } from '../../../../types/QuranReader';

const WORD_SURAH = 'سُورَة';
const toLocalizedNumber = (value: number, _locale: string) =>
  String(value).replace(/\d/g, (n) => '٠١٢٣٤٥٦٧٨٩'[Number(n)]);
const convertHexToRGBA = (hex: string, opacity: number) => {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  return `rgba(${parseInt(full.slice(0, 2), 16)},${parseInt(full.slice(2, 4), 16)},${parseInt(
    full.slice(4, 6),
    16,
  )},${opacity})`;
};
const getPlainTranslationText = (text: string) => text;
const Alignment = { CENTRE: 'centre', JUSTIFIED: 'justified' };
export type VerseOverlayProps = {
  arabic: string;
  chapterId: number;
  verseNumber: number;
  juzNumber?: number;
  chapterArabicName: string;
  translations: { id: number | string; text: string }[];
  isPortrait: boolean;
  showLogo: boolean;
  showSurahInfo: boolean;
  showArabic: boolean;
  backgroundColor: string;
  opacity: number;
  fontColor: string;
  borderColor: string;
  borderSize: number;
  verseAlignment: string;
  translationAlignment: string;
  quranTextFontScale: number;
  quranTextFontStyle: string;
  translationFontScale: number;
};
// Shared by the frontend export and unattended agent: one source for the layout.
export default function VerseOverlay({
  arabic,
  chapterId,
  verseNumber,
  juzNumber,
  chapterArabicName,
  translations,
  isPortrait,
  showLogo,
  showSurahInfo,
  showArabic,
  backgroundColor,
  opacity,
  fontColor,
  borderColor,
  borderSize,
  verseAlignment,
  translationAlignment,
  quranTextFontScale,
  quranTextFontStyle,
  translationFontScale,
}: VerseOverlayProps) {
  return (
    <>
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
              {juzNumber && (
                <span className={styles.juzNumber}>
                  {`الجزء ${toLocalizedNumber(juzNumber, 'ar')}`}
                </span>
              )}

              <span className={styles.surahArabic}>{`${WORD_SURAH} ${chapterArabicName}`}</span>
              <span className={styles.surahNumber}>
                {toLocalizedNumber(Number(chapterId), 'ar')}
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
            {arabic}
          </div>
        )}

        {translations.map((translation) => (
          <div
            key={translation.id}
            className={classNames(styles.translation, {
              [styles.verseTranslationCentre]: translationAlignment === Alignment.CENTRE,
              [styles.verseTranslationJustified]: translationAlignment === Alignment.JUSTIFIED,
            })}
          >
            <div
              style={{ fontSize: translationFontScale * 10.1 }}
              dangerouslySetInnerHTML={{
                __html: getPlainTranslationText(
                  `${translation.text} (${chapterId}:${verseNumber})`,
                ),
              }}
            />
          </div>
        ))}
      </AbsoluteFill>
    </>
  );
}
