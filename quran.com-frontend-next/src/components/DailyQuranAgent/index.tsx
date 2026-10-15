import React, { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  Audio,
  Composition,
  Loop,
  Sequence,
  Video,
  cancelRender,
  continueRender,
  delayRender,
  registerRoot,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import VerseOverlay from '../MediaMaker/Content/VerseOverlay';

// Cloud renders use temporary signed media URLs; local renders use static files.
const assetSrc = (src: string) => (src.startsWith('https://') ? src : staticFile(src));

type Cue = {
  key: string;
  arabic: string;
  displayArabic?: string;
  translation: string;
  fromFrame: number;
  toFrame: number;
  juzNumber?: number;
  arabicFrames?: number;
  urduFromFrame?: number;
  urduFrames?: number;
  arabicAudioSrc?: string;
  urduAudioSrc?: string;
};
type Props = {
  textPanelOpacity?: number;
  fontSources?: Record<string, string>;
  passageName: string;
  passageId: string;
  translator: string;
  language: string;
  chapterId: number;
  chapterArabicName: string;
  translationAudio?: string;
  cues: Cue[];
  intro: number;
  fps: number;
  durationInFrames: number;
  audioSrc: string;
  background: { kind: string; src?: string; seed?: number; theme: string; creator?: string };
};

const defaults: Props = {
  passageName: '',
  passageId: '',
  translator: '',
  language: 'urdu',
  chapterId: 1,
  chapterArabicName: '',
  cues: [],
  intro: 36,
  fps: 24,
  durationInFrames: 60,
  audioSrc: '',
  background: { kind: 'generated', theme: 'night sky', seed: 1 },
};

// Decorative scenery only. No generated scriptural text or depictions of the unseen.
const Scenery = ({ background }: { background: Props['background'] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (background.kind === 'video' && background.src) {
    return (
      <AbsoluteFill>
        <Loop durationInFrames={fps * 5}>
          <Video
            muted
            src={assetSrc(background.src)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Loop>
      </AbsoluteFill>
    );
  }
  const night = background.theme === 'night sky';
  const phase = (frame / fps) * 0.006;
  return (
    <AbsoluteFill
      style={{
        background: night
          ? 'linear-gradient(#08172e, #224765 70%, #344c61)'
          : 'linear-gradient(#1a405a, #698991 65%, #566f73)',
      }}
    >
      <svg viewBox="0 0 720 1280" style={{ width: '100%', height: '100%' }} aria-hidden="true">
        {night &&
          Array.from({ length: 65 }, (_, i) => {
            const x = ((i * 173 + (background.seed || 0)) % 701) + 10;
            const y = ((i * 97 + (background.seed || 0)) % 810) + 15;
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={i % 3 === 0 ? 1.8 : 1}
                fill="white"
                opacity={0.3 + 0.25 * Math.sin(phase + i)}
              />
            );
          })}
        {!night && (
          <g fill="#dae2e2" opacity="0.12" transform={`translate(${Math.sin(phase) * 25},0)`}>
            <ellipse cx="160" cy="240" rx="230" ry="70" />
            <ellipse cx="650" cy="370" rx="270" ry="75" />
          </g>
        )}
        <path
          d="M0 1020 L120 850 L235 975 L395 740 L580 995 L720 830 L720 1280 L0 1280Z"
          fill="#183647"
        />
        <path
          d="M0 1120 L170 1030 L330 1160 L540 1015 L720 1090 L720 1280 L0 1280Z"
          fill="#112b39"
        />
      </svg>
    </AbsoluteFill>
  );
};

const DailyVideo = (props: Props) => {
  const frame = useCurrentFrame();
  const cue =
    props.cues.find((c) => frame >= c.fromFrame && frame < c.toFrame) || props.cues.at(-1);
  const [fontHandle] = useState(() => delayRender('Loading verified Arabic font'));
  useEffect(() => {
    const fontSrc = (name: string) => props.fontSources?.[name] || staticFile(name);
    const arabic = new FontFace('UthmanicHafs', `url("${fontSrc('UthmanicHafs1Ver18.woff2')}")`);
    const urdu = new FontFace(
      'NotoNastaliq',
      `url("${fontSrc('NotoNaskhArabic-Regular.woff2')}")`,
    );
    const latin = new FontFace('Figtree', `url("${fontSrc('Figtree.ttf')}")`);
    const logo = new FontFace(
      'PlayfairDisplay',
      `url("${fontSrc('PlayfairDisplay-Black.ttf')}")`,
    );
    Promise.all([arabic.load(), urdu.load(), latin.load(), logo.load()])
      .then((fonts) => {
        fonts.forEach((font) => document.fonts.add(font));
        continueRender(fontHandle);
      })
      .catch(cancelRender);
  }, [fontHandle]);
  if (!cue) return <AbsoluteFill style={{ background: '#071b2d' }} />;
  return (
    <AbsoluteFill>
      <Scenery background={props.background} />
      <VerseOverlay
        arabic={cue.displayArabic || cue.arabic}
        chapterId={props.chapterId}
        verseNumber={Number(cue.key.split(':')[1])}
        juzNumber={cue.juzNumber}
        chapterArabicName={props.chapterArabicName}
        translations={[{ id: props.translator, text: cue.translation }]}
        isPortrait
        showLogo
        showSurahInfo
        showArabic
        backgroundColor="#000000"
        opacity={props.textPanelOpacity ?? 0.2}
        fontColor="#ffffff"
        borderColor="#000000"
        borderSize={0}
        verseAlignment="centre"
        translationAlignment="centre"
        quranTextFontScale={4}
        quranTextFontStyle="qpc_uthmani_hafs"
        translationFontScale={3}
      />
      {props.translationAudio && props.translationAudio !== 'none'
        ? props.cues.map((c) => (
            <React.Fragment key={c.key}>
              {props.translationAudio === 'urdu' && c.arabicAudioSrc && (
                <Sequence from={c.fromFrame} durationInFrames={c.arabicFrames}>
                  <Audio src={assetSrc(c.arabicAudioSrc)} />
                </Sequence>
              )}
              {c.urduAudioSrc && (
                <Sequence from={c.urduFromFrame} durationInFrames={c.urduFrames}>
                  <Audio src={assetSrc(c.urduAudioSrc)} />
                </Sequence>
              )}
            </React.Fragment>
          ))
        : props.audioSrc && (
            <Sequence from={props.intro}>
              <Audio src={assetSrc(props.audioSrc)} startFrom={0} />
            </Sequence>
          )}
    </AbsoluteFill>
  );
};

const Root = () => (
  <Composition
    id="DailyQuranVideo"
    component={DailyVideo}
    width={720}
    height={1280}
    fps={24}
    durationInFrames={60}
    defaultProps={defaults}
    calculateMetadata={({ props }) => ({
      durationInFrames: props.durationInFrames,
      fps: props.fps,
    })}
  />
);
registerRoot(Root);
