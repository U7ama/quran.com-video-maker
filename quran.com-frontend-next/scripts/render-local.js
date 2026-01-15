const fs = require('fs').promises;
const http = require('http');
const https = require('https');
const path = require('path');
const { exec } = require('child_process');

async function downloadTranslationAudio(verses, translationAudio, providedDurations = {}) {
  if (translationAudio !== 'urdu' && translationAudio !== 'urdu-only') {
    return { files: [], durations: {} };
  }

  const translationAudioFiles = [];
  const translationDurations = {};
  const audioDir = path.join(process.cwd(), 'tmp', 'translation_audio');
  await fs.mkdir(audioDir, { recursive: true });

  for (const verse of verses) {
    const chapterId = String(verse.chapterId).padStart(3, '0');
    const verseNumber = String(verse.verseNumber).padStart(3, '0');
    const url = `https://everyayah.com/data/translations/urdu_shamshad_ali_khan_46kbps/${chapterId}${verseNumber}.mp3`;
    const outputPath = path.join(audioDir, `trans_${chapterId}_${verseNumber}.mp3`);
    const verseKey = `${verse?.chapterId}:${verse?.verseNumber}`;

    try {
      await downloadFileWithRetry(url, outputPath);

      // Use provided duration if available, otherwise fetch from file
      let durationInFrames;
      if (providedDurations[verseKey]) {
        durationInFrames = providedDurations[verseKey];
        console.log(`Using provided duration for ${verseKey}: ${durationInFrames} frames`);
      } else {
        const duration = await getAudioDurationFromFile(outputPath);
        durationInFrames = Math.ceil(duration * 30);
        console.log(`Fetched duration for ${verseKey}: ${durationInFrames} frames`);
      }

      translationDurations[verseKey] = durationInFrames;

      translationAudioFiles.push({
        verseKey,
        audioPath: outputPath,
        url,
        duration: durationInFrames,
      });
    } catch (error) {
      console.error(
        `Failed to download translation audio for ${chapterId}:${verseNumber}: ${error.message}`,
      );
      translationDurations[verseKey] = 300; // 10 seconds default
    }
  }

  return { files: translationAudioFiles, durations: translationDurations };
}

// Add this helper function to get audio duration from file
async function getAudioDurationFromFile(filePath) {
  return new Promise((resolve, reject) => {
    const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.warn(`Could not get duration for ${filePath}, using default`);
        resolve(10); // Default to 10 seconds
        return;
      }
      const duration = parseFloat(stdout);
      resolve(isNaN(duration) ? 10 : duration);
    });
  });
}

// Function to download a file from URL
async function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading audio from ${url} to ${outputPath}`);

    // Create the directory if it doesn't exist
    fs.mkdir(path.dirname(outputPath), { recursive: true })
      .then(() => {
        // Select http or https based on URL
        const client = url.startsWith('https') ? https : http;

        const request = client.get(url, (response) => {
          // Handle redirects
          if (response.statusCode === 301 || response.statusCode === 302) {
            console.log(`Following redirect to: ${response.headers.location}`);
            return downloadFile(response.headers.location, outputPath).then(resolve).catch(reject);
          }

          if (response.statusCode !== 200) {
            return reject(new Error(`Failed to download file: ${response.statusCode}`));
          }

          const fileStream = fs
            .open(outputPath, 'w')
            .then((fileHandle) => {
              const writeStream = fileHandle.createWriteStream();
              response.pipe(writeStream);

              writeStream.on('finish', () => {
                fileHandle.close().then(() => {
                  console.log(`Downloaded file to ${outputPath}`);
                  resolve(outputPath);
                });
              });

              writeStream.on('error', (err) => {
                fileHandle.close().then(() => reject(err));
              });
            })
            .catch(reject);
        });

        request.on('error', reject);
      })
      .catch(reject);
  });
}
// Update the renderVideoLocally function to ensure durations are calculated before timestamp adjustment

async function renderVideoLocally(inputProps, outputPath) {
  try {
    console.log('Starting rendering process...');
    console.log('Input props translationAudio:', inputProps.translationAudio);
    console.log('Input props timestamps:', JSON.stringify(inputProps.timestamps, null, 2));

    // Fix the input props by ensuring durationInFrames is a valid integer
    const fixedProps = { ...inputProps };

    // Make sure FPS is a valid number
    if (!fixedProps.fps || isNaN(fixedProps.fps)) {
      fixedProps.fps = 30;
    }

    // Convert translations to strings if they are numbers
    if (fixedProps.translations) {
      fixedProps.translations = fixedProps.translations.map((t) => t.toString());
      console.log('Converted translations to strings:', fixedProps.translations);
    }

    // Download audio file if it exists with enhanced reliability
    if (fixedProps.audio && fixedProps.audio.audioUrl) {
      const { audioUrl } = fixedProps.audio;
      const audioFileName = path.basename(audioUrl);
      const localAudioPath = path.join(process.cwd(), 'tmp', 'audio', audioFileName);

      try {
        await downloadAudioWithFallbacks(audioUrl, localAudioPath);
        // Update the audio URL to the local path
        fixedProps.audio.localAudioPath = localAudioPath;
        console.log(`Audio downloaded to ${localAudioPath}`);
      } catch (error) {
        console.error(`Failed to download audio: ${error.message}`);
        console.log('Continuing without audio...');
      }
    }

    // Download translation audio files if enabled
    if (
      fixedProps.translationAudio &&
      fixedProps.translationAudio !== 'none' &&
      fixedProps.verses
    ) {
      console.log(`Downloading ${fixedProps.translationAudio} translation audio...`);

      // Check if timestamps already have urduDuration (from client)
      const timestampsHaveUrduDuration =
        fixedProps.timestamps &&
        fixedProps.timestamps.length > 0 &&
        fixedProps.timestamps[0].urduDuration !== undefined;

      const isUrduOnly = fixedProps.translationAudio === 'urdu-only';
      console.log('Timestamps have urduDuration?', timestampsHaveUrduDuration);
      console.log('Is Urdu-only mode?', isUrduOnly);

      // Check if durations are already provided from the client
      const providedDurations = fixedProps.translationDurations || {};
      console.log('Provided translation durations from client:', providedDurations);

      const { files: translationFiles, durations: translationDurations } =
        await downloadTranslationAudio(
          fixedProps.verses,
          fixedProps.translationAudio,
          providedDurations,
        );

      fixedProps.translationAudioFiles = translationFiles;
      fixedProps.translationDurations = translationDurations;
      console.log(`Downloaded ${translationFiles.length} translation audio files`);
      console.log('Final translation durations:', translationDurations);

      if (timestampsHaveUrduDuration) {
        console.log('✅ Using pre-calculated timestamps from client with urduDuration');

        // Timestamps already have urduDuration, just verify and calculate total duration
        fixedProps.timestamps.forEach((ts, i) => {
          const verse = fixedProps.verses[i];
          const verseKey = `${verse?.chapterId}:${verse?.verseNumber}`;
          console.log(
            `Timestamp ${i} for ${verseKey}: start=${ts.start}, arabicDuration=${ts.durationInFrames}, urduDuration=${ts.urduDuration}, urduStart=${ts.urduStart}`,
          );
        });

        // Recalculate timestamps and duration by accumulating through all verses (same logic as player)
        // This ensures consistency and correct positioning
        let currentPosition = 0;
        const bufferFrames = 15; // 0.5 seconds buffer at 30fps
        const recalculatedTimestamps = [];
        const isUrduOnly = fixedProps.translationAudio === 'urdu-only';

        for (let i = 0; i < fixedProps.timestamps.length; i++) {
          const originalTimestamp = fixedProps.timestamps[i];
          const arabicDuration = originalTimestamp.durationInFrames;

          // Prefer urduDuration from timestamp (calculated by player) for consistency
          // Only use translationDurations if timestamp doesn't have it
          const verse = fixedProps.verses[i];
          const verseKey = `${verse?.chapterId}:${verse?.verseNumber}`;
          const urduDurationFromTimestamp = originalTimestamp.urduDuration;
          const urduDurationFromDownload = translationDurations[verseKey];
          const urduDuration = urduDurationFromTimestamp || urduDurationFromDownload || 300;

          // Log if there's a mismatch (for debugging)
          if (
            urduDurationFromTimestamp &&
            urduDurationFromDownload &&
            urduDurationFromTimestamp !== urduDurationFromDownload
          ) {
            console.warn(
              `⚠️ Duration mismatch for ${verseKey}: timestamp=${urduDurationFromTimestamp}, downloaded=${urduDurationFromDownload}, using timestamp value=${urduDurationFromTimestamp}`,
            );
          }

          if (isUrduOnly) {
            // Urdu-only mode: only Urdu audio, no Arabic, no buffer
            recalculatedTimestamps.push({
              ...originalTimestamp,
              start: currentPosition,
              urduStart: currentPosition, // Urdu starts immediately (no Arabic before it)
              urduDuration: urduDuration,
            });

            // Accumulate: Only Urdu (no Arabic, no buffer)
            currentPosition += urduDuration;

            console.log(
              `Verse ${i} (${verseKey}) [Urdu-only]: start=${recalculatedTimestamps[i].start}, Urdu=${urduDuration}, Position after=${currentPosition}`,
            );
          } else {
            // Urdu mode: Arabic + buffer + Urdu
            recalculatedTimestamps.push({
              ...originalTimestamp,
              start: currentPosition,
              urduStart: currentPosition + arabicDuration + bufferFrames,
              urduDuration: urduDuration,
            });

            // Accumulate: Arabic + buffer + Urdu
            currentPosition += arabicDuration + bufferFrames + urduDuration;

            console.log(
              `Verse ${i} (${verseKey}): start=${recalculatedTimestamps[i].start}, Arabic=${arabicDuration}, Urdu=${urduDuration}, urduStart=${recalculatedTimestamps[i].urduStart}, Position after=${currentPosition}`,
            );
          }
        }

        fixedProps.timestamps = recalculatedTimestamps;
        fixedProps.durationInFrames = currentPosition + 60; // Add 2 seconds buffer at end

        console.log(`✅ Recalculated timestamps and total duration by accumulating all verses:`);
        console.log(`   Accumulated position: ${currentPosition}`);
        console.log(
          `   Total: ${fixedProps.durationInFrames} frames (${(
            fixedProps.durationInFrames / 30
          ).toFixed(2)} seconds)`,
        );
      } else {
        console.log('⚠️ Timestamps do NOT have urduDuration, calculating them now');

        // Timestamps don't have urduDuration, calculate them
        let currentPosition = 0;
        const adjustedTimestamps = [];
        const bufferFrames = 15; // 0.5 seconds buffer at 30fps
        const isUrduOnly = fixedProps.translationAudio === 'urdu-only';

        for (let i = 0; i < fixedProps.timestamps.length; i++) {
          const originalTimestamp = fixedProps.timestamps[i];
          const arabicDuration = originalTimestamp.durationInFrames;

          // Get the actual Urdu duration for this verse
          const verse = fixedProps.verses[i];
          const verseKey = `${verse?.chapterId}:${verse?.verseNumber}`;
          const urduDuration = translationDurations[verseKey];

          if (!urduDuration) {
            console.error(`Missing Urdu duration for verse ${verseKey}, using default`);
          }

          const actualUrduDuration = urduDuration || 300;

          if (isUrduOnly) {
            // Urdu-only mode: only Urdu audio, no Arabic, no buffer
            console.log(`Verse ${verseKey} [Urdu-only]: Urdu=${actualUrduDuration} frames`);

            adjustedTimestamps.push({
              ...originalTimestamp,
              start: currentPosition,
              urduStart: currentPosition, // Urdu starts immediately
              urduDuration: actualUrduDuration,
            });

            // Accumulate: Only Urdu (no Arabic, no buffer)
            currentPosition += actualUrduDuration;
          } else {
            // Urdu mode: Arabic + buffer + Urdu
            console.log(
              `Verse ${verseKey}: Arabic=${arabicDuration} frames, Urdu=${actualUrduDuration} frames`,
            );

            adjustedTimestamps.push({
              ...originalTimestamp,
              start: currentPosition,
              end: currentPosition + arabicDuration,
              urduStart: currentPosition + arabicDuration + bufferFrames,
              urduDuration: actualUrduDuration,
            });

            currentPosition += arabicDuration + bufferFrames + actualUrduDuration;
          }
        }

        fixedProps.timestamps = adjustedTimestamps;
        fixedProps.durationInFrames = currentPosition + 60;
        console.log(
          `Adjusted duration to ${fixedProps.durationInFrames} frames for sequential Arabic and Urdu audio`,
        );
      }
    } else {
      // No translation audio, calculate duration from timestamps
      if (!fixedProps.durationInFrames || isNaN(fixedProps.durationInFrames)) {
        if (fixedProps.timestamps && fixedProps.timestamps.length > 0) {
          const frames = fixedProps.timestamps.map((t) => Number(t.frame || 0));
          const maxFrame = Math.max(...frames);
          fixedProps.durationInFrames = Math.round(maxFrame + 60);
        } else {
          fixedProps.durationInFrames = 300;
        }
        console.log(`Set durationInFrames to ${fixedProps.durationInFrames}`);
      } else {
        fixedProps.durationInFrames = Math.round(fixedProps.durationInFrames);
      }
    }

    console.log(
      `🎬 FINAL DURATION IN FRAMES: ${fixedProps.durationInFrames} (${(
        fixedProps.durationInFrames / 30
      ).toFixed(2)} seconds)`,
    );

    // Create a new props file with the fixed properties
    const fixedPropsPath = path.join(
      path.dirname(process.argv[2]),
      `fixed-${path.basename(process.argv[2])}`,
    );
    await fs.writeFile(fixedPropsPath, JSON.stringify(fixedProps, null, 2));

    console.log(`Wrote fixed props to: ${fixedPropsPath}`);

    // Instead of using the Remotion Node.js API, use the CLI command that works
    const cliCommand = `npx remotion render src/components/MediaMaker/index.ts MediaMakerContent "${outputPath}" --props="${fixedPropsPath}" --log=verbose --codec=h264 --audio-codec=aac`;

    console.log('Executing command:', cliCommand);

    // Execute with progress tracking
    const child = exec(cliCommand);

    // Parse progress from stdout
    child.stdout.on('data', (data) => {
      console.log(data.toString());
    });

    child.stderr.on('data', (data) => {
      console.error(data.toString());
    });

    return new Promise((resolve, reject) => {
      child.on('close', async (code) => {
        try {
          // Clean up the fixed props file
          await fs.unlink(fixedPropsPath).catch(() => {});

          if (code === 0) {
            try {
              const stats = await fs.stat(outputPath);
              console.log(`Video rendered successfully: ${outputPath} (${stats.size} bytes)`);
              resolve(true);
            } catch (error) {
              reject(new Error(`Output file not created at ${outputPath}`));
            }
          } else {
            reject(new Error(`Render process exited with code ${code}`));
          }
        } catch (error) {
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error('Rendering error:', error);
    throw error;
  }
}

// If this script is run directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node render-local.js <inputPropsPath> <outputPath>');
    process.exit(1);
  }

  const inputPropsPath = args[0];
  const outputPath = args[1];

  console.log('Arguments:');
  console.log('- Input props path:', inputPropsPath);
  console.log('- Output path:', outputPath);

  // Read input props from file
  fs.readFile(inputPropsPath, 'utf8')
    .then((inputPropsJson) => {
      const inputProps = JSON.parse(inputPropsJson);
      return renderVideoLocally(inputProps, outputPath);
    })
    .then(() => {
      console.log(`Video rendered successfully to: ${outputPath}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed to render video:', error);
      process.exit(1);
    });
}

// Enhanced download function with retries and timeout settings
async function downloadFileWithRetry(url, outputPath, maxRetries = 3, timeout = 30000) {
  let attempts = 0;

  while (attempts < maxRetries) {
    attempts++;
    console.log(`Download attempt ${attempts}/${maxRetries} for ${url}`);

    try {
      await new Promise((resolve, reject) => {
        // Create the directory if it doesn't exist
        fs.mkdir(path.dirname(outputPath), { recursive: true })
          .then(() => {
            // Select http or https based on URL
            const client = url.startsWith('https') ? https : http;

            // Add timeout to the request
            const request = client.get(url, { timeout }, (response) => {
              // Handle redirects
              if (response.statusCode === 301 || response.statusCode === 302) {
                console.log(`Following redirect to: ${response.headers.location}`);
                return downloadFileWithRetry(
                  response.headers.location,
                  outputPath,
                  maxRetries - attempts,
                  timeout,
                )
                  .then(resolve)
                  .catch(reject);
              }

              if (response.statusCode !== 200) {
                return reject(
                  new Error(`Server responded with status code: ${response.statusCode}`),
                );
              }

              // Cache the audio in memory first before writing to disk
              const chunks = [];
              response.on('data', (chunk) => chunks.push(chunk));

              response.on('end', async () => {
                try {
                  const buffer = Buffer.concat(chunks);
                  await fs.writeFile(outputPath, buffer);
                  console.log(`Downloaded file to ${outputPath} (${buffer.length} bytes)`);
                  resolve(outputPath);
                } catch (err) {
                  reject(err);
                }
              });
            });

            request.on('error', (err) => {
              reject(new Error(`Network error: ${err.message}`));
            });

            request.on('timeout', () => {
              request.destroy();
              reject(new Error(`Request timed out after ${timeout}ms`));
            });
          })
          .catch(reject);
      });

      // If we get here, download was successful
      return outputPath;
    } catch (error) {
      console.error(`Attempt ${attempts} failed: ${error.message}`);

      // If this was the last attempt, rethrow the error
      if (attempts >= maxRetries) {
        throw new Error(`Failed to download after ${maxRetries} attempts: ${error.message}`);
      }

      // Wait before retrying (exponential backoff)
      const delayMs = Math.min(1000 * Math.pow(2, attempts), 10000);
      console.log(`Waiting ${delayMs}ms before next attempt...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// Alternative audio sources to try if primary source fails
const ALTERNATIVE_AUDIO_SOURCES = {
  mishari_al_afasy: [
    'https://download.quranicaudio.com/quran/mishaari_raashid_al_3afaasee/',
    'https://verses.quran.com/mishari-rashid-alafasy/',
  ],
};

// Function to try alternative audio sources
async function downloadAudioWithFallbacks(originalUrl, outputPath) {
  try {
    // Try the original URL first
    return await downloadFileWithRetry(originalUrl, outputPath);
  } catch (error) {
    console.log(`Primary audio source failed: ${error.message}`);

    // Parse the original URL to extract reciter and surah info
    const urlParts = originalUrl.split('/');
    const filename = urlParts[urlParts.length - 1]; // e.g., "8.mp3"
    const reciterPath = urlParts[urlParts.length - 3]; // e.g., "mishari_al_afasy"

    // Try alternative sources if available
    if (ALTERNATIVE_AUDIO_SOURCES[reciterPath]) {
      for (const alternativeBase of ALTERNATIVE_AUDIO_SOURCES[reciterPath]) {
        const alternativeUrl = `${alternativeBase}${filename}`;
        console.log(`Trying alternative source: ${alternativeUrl}`);

        try {
          return await downloadFileWithRetry(alternativeUrl, outputPath);
        } catch (altError) {
          console.log(`Alternative source failed: ${altError.message}`);
        }
      }
    }

    // If all alternatives fail, throw the original error
    throw error;
  }
}

module.exports = { renderVideoLocally };
