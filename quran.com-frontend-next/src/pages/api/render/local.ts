import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';

// Configure API route to accept larger body size (up to 150MB for video uploads)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '150mb',
    },
  },
};

// Define our schema with more flexible translations field
const RenderRequestSchema = z.object({
  verses: z.array(z.any()).optional(),
  audio: z.any().optional(),
  timestamps: z.array(z.any()).optional(),
  backgroundColor: z.string().optional(),
  opacity: z.number().optional(),
  borderColor: z.string().optional(),
  borderSize: z.number().optional(),
  fontColor: z.string().optional(),
  verseAlignment: z.string().optional(),
  translationAlignment: z.string().optional(),
  video: z.any().optional(),
  quranTextFontScale: z.number().optional(),
  quranTextFontStyle: z.string().optional(),
  translationFontScale: z.number().optional(),
  orientation: z.string().optional(),
  videoId: z.number().optional(),
  chapterEnglishName: z.string().optional(),
  // Accept either array of strings or array of numbers for translations
  translations: z.array(z.union([z.string(), z.number()])).optional(),
  translationAudio: z.string().optional(), // ADD THIS LINE
  previewMode: z.string().optional(),
  requestId: z.string(), // Only required field
  width: z.number().optional(),
  height: z.number().optional(),
  durationInFrames: z.number().optional(),
  fps: z.number().optional(),
  isPlayer: z.boolean().optional(),
  customVideoData: z.union([z.string(), z.null()]).optional(), // Base64 encoded video data
  showArabic: z.boolean().optional(),
  showLogo: z.boolean().optional(),
  showSurahInfo: z.boolean().optional(),
});

const execAsync = promisify(exec);

// ADD THIS HELPER FUNCTION for cleaning up translation audio files
async function cleanupTranslationAudio(tmpDir: string) {
  try {
    const translationAudioDir = path.join(tmpDir, 'translation_audio');

    try {
      await fs.access(translationAudioDir);
      const translationFiles = await fs.readdir(translationAudioDir);

      if (translationFiles.length > 0) {
        console.log('Found translation audio files to delete:', translationFiles);

        for (const file of translationFiles) {
          try {
            await fs.unlink(path.join(translationAudioDir, file));
            console.log(`Cleaned up translation audio file: ${file}`);
          } catch (err) {
            console.warn(`Failed to delete translation audio file ${file}: ${err.message}`);
          }
        }
      }
    } catch (err) {
      console.log('Translation audio directory does not exist or is empty');
    }
  } catch (err) {
    console.warn('Error cleaning up translation audio files:', err);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse request body with our schema
    const inputProps = RenderRequestSchema.parse(req.body);

    // Convert translations to strings if they're numbers
    if (inputProps.translations) {
      inputProps.translations = inputProps.translations.map((t) => t.toString());
    }

    if (
      (inputProps.translationAudio === 'urdu' || inputProps.translationAudio === 'urdu-only') &&
      inputProps.timestamps
    ) {
      console.log(
        'Timestamps received:',
        JSON.stringify(
          inputProps.timestamps.map((t) => ({
            start: t.start,
            durationInFrames: t.durationInFrames,
            urduDuration: t.urduDuration,
            urduStart: t.urduStart,
          })),
          null,
          2,
        ),
      );
    }

    // ENSURE translationAudio is included with a default value
    if (!inputProps.translationAudio) {
      inputProps.translationAudio = 'none';
    }

    // Handle custom video (blob URL) - convert base64 to file and copy to public directory
    if (
      inputProps.customVideoData &&
      typeof inputProps.customVideoData === 'string' &&
      inputProps.video?.videoSrc?.startsWith('blob:')
    ) {
      try {
        // Extract base64 data (remove data:video/...;base64, prefix)
        const base64Data = inputProps.customVideoData.split(',')[1] || inputProps.customVideoData;
        const videoBuffer = Buffer.from(base64Data, 'base64');

        // Determine file extension from mime type or default to mp4
        const mimeMatch = inputProps.customVideoData.match(/data:video\/([^;]+)/);
        const extension = mimeMatch ? mimeMatch[1] : 'mp4';
        const videoFileName = `custom-video-${inputProps.requestId}.${extension}`;

        // Copy to Remotion's public directory (public/publicMin) so it can be accessed via staticFile()
        const publicVideoDir = path.join(process.cwd(), 'public', 'publicMin', 'custom-videos');
        await fs.mkdir(publicVideoDir, { recursive: true });
        const publicVideoPath = path.join(publicVideoDir, videoFileName);
        await fs.writeFile(publicVideoPath, videoBuffer);
        console.log(`Saved custom video to public directory: ${publicVideoPath}`);

        // Update video path to use staticFile path (relative to public/publicMin)
        inputProps.video = {
          ...inputProps.video,
          videoSrc: `/custom-videos/${videoFileName}`,
          isCustomVideo: true,
        };
      } catch (error) {
        console.error('Failed to save custom video:', error);
        return res.status(500).json({
          error: 'Failed to process custom video',
          details: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Create tmp directory if it doesn't exist
    const tmpDir = path.join(process.cwd(), 'tmp');
    await fs.mkdir(tmpDir, { recursive: true });

    // Generate unique output path
    const outputPath = path.join(tmpDir, `output-${inputProps.requestId}.mp4`);
    const inputPropsPath = path.join(tmpDir, `input-${inputProps.requestId}.json`);

    // Write input props to a temporary file to avoid shell interpretation issues
    await fs.writeFile(inputPropsPath, JSON.stringify(inputProps, null, 2));

    // Run the rendering script with file path instead of JSON string
    const scriptPath = path.join(process.cwd(), 'scripts/render-local.js');

    // Use double quotes for Windows paths with spaces
    const command = `node "${scriptPath}" "${inputPropsPath}" "${outputPath}"`;

    console.log('Executing command:', command);
    console.log('Translation audio setting:', inputProps.translationAudio); // ADD THIS LOG

    await execAsync(command);

    // Check if the output file exists
    try {
      await fs.access(outputPath);
    } catch (error) {
      return res.status(500).json({
        error: 'Output file not created',
        details: 'The render process completed but did not create an output file',
      });
    }

    // Read the generated video file
    const videoBuffer = await fs.readFile(outputPath);

    // Clean up the temporary files
    await fs
      .unlink(outputPath)
      .catch((err) => console.warn(`Failed to delete output file: ${err.message}`));
    await fs
      .unlink(inputPropsPath)
      .catch((err) => console.warn(`Failed to delete input file: ${err.message}`));

    // Clean up custom video file from public directory if it was created
    if (inputProps.video?.isCustomVideo && inputProps.video?.videoSrc) {
      try {
        const publicVideoPath = path.join(
          process.cwd(),
          'public',
          'publicMin',
          inputProps.video.videoSrc,
        );
        await fs.unlink(publicVideoPath);
        console.log('Cleaned up custom video file from public directory');
      } catch (err) {
        console.warn(`Failed to delete custom video file: ${err.message}`);
      }
    }

    try {
      const files = await fs.readdir(tmpDir);
      console.log('Files in tmp directory:', files);

      // Check specifically for the audio subdirectory
      const audioDir = path.join(tmpDir, 'audio');

      try {
        // Check if audio directory exists
        await fs.access(audioDir);

        // Read files from audio subdirectory
        const audioFiles = await fs.readdir(audioDir);
        console.log('Files in audio subdirectory:', audioFiles);

        // Filter for audio files
        const audioFilesToDelete = audioFiles.filter(
          (f) => f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.ogg'),
        );

        // Log what audio files exist for debugging
        if (audioFilesToDelete.length > 0) {
          console.log('Found audio files to delete:', audioFilesToDelete);

          // Delete each audio file from the audio subdirectory
          for (const file of audioFilesToDelete) {
            try {
              await fs.unlink(path.join(audioDir, file));
              console.log(`Cleaned up audio file: ${file}`);
            } catch (err) {
              console.warn(`Failed to delete audio file ${file}: ${err.message}`);
            }
          }
        } else {
          console.log('No audio files found to delete in audio subdirectory');
        }
      } catch (err) {
        console.warn('Audio directory does not exist or cannot be accessed:', err);
      }

      // ADD THIS: Clean up translation audio files
      await cleanupTranslationAudio(tmpDir);
    } catch (err) {
      console.warn('Error scanning tmp directory for audio files:', err);
    }

    // Set appropriate headers for video download
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename=quran-video.mp4');

    // Send the video buffer as response
    return res.send(videoBuffer);
  } catch (error) {
    console.error('Local rendering error:', error);
    return res.status(500).json({
      error: 'Failed to render video',
      details: error instanceof Error ? error.message : JSON.stringify(error, null, 2),
    });
  }
}
