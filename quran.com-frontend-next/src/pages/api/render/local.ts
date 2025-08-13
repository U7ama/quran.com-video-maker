import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';

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
  previewMode: z.string().optional(),
  requestId: z.string(), // Only required field
  width: z.number().optional(),
  height: z.number().optional(),
  durationInFrames: z.number().optional(),
  fps: z.number().optional(),
  isPlayer: z.boolean().optional(),
});

const execAsync = promisify(exec);

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

    // Clean up the temporary files - commented out for debugging
    await fs
      .unlink(outputPath)
      .catch((err) => console.warn(`Failed to delete output file: ${err.message}`));
    await fs
      .unlink(inputPropsPath)
      .catch((err) => console.warn(`Failed to delete input file: ${err.message}`));

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
