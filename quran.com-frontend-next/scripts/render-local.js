const fs = require('fs').promises;
const http = require('http');
const https = require('https');
const path = require('path');
const { exec } = require('child_process');

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

async function renderVideoLocally(inputProps, outputPath) {
  try {
    console.log('Starting rendering process...');

    // Fix the input props by ensuring durationInFrames is a valid integer
    const fixedProps = { ...inputProps };

    // Calculate durationInFrames from timestamps or provide a default
    if (!fixedProps.durationInFrames || isNaN(fixedProps.durationInFrames)) {
      if (fixedProps.timestamps && fixedProps.timestamps.length > 0) {
        // Get the maximum frame from timestamps
        const frames = fixedProps.timestamps.map((t) => Number(t.frame || 0));
        const maxFrame = Math.max(...frames);
        fixedProps.durationInFrames = Math.round(maxFrame + 60); // Add 2 seconds buffer
      } else {
        // Default to 10 seconds at 30fps
        fixedProps.durationInFrames = 300;
      }
      console.log(`Set durationInFrames to ${fixedProps.durationInFrames}`);
    } else {
      // Ensure it's an integer
      fixedProps.durationInFrames = Math.round(fixedProps.durationInFrames);
    }

    // Make sure FPS is a valid number
    if (!fixedProps.fps || isNaN(fixedProps.fps)) {
      fixedProps.fps = 30;
    }

    // Convert translations to strings if they are numbers
    if (fixedProps.translations) {
      fixedProps.translations = fixedProps.translations.map((t) => t.toString());
      console.log('Converted translations to strings:', fixedProps.translations);
    }

    // Download audio file if it exists
    if (fixedProps.audio && fixedProps.audio.audioUrl) {
      const { audioUrl } = fixedProps.audio;
      const audioFileName = path.basename(audioUrl);
      const localAudioPath = path.join(process.cwd(), 'tmp', 'audio', audioFileName);

      try {
        await downloadFile(audioUrl, localAudioPath);
        // Update the audio URL to the local path
        fixedProps.audio.localAudioPath = localAudioPath;
        console.log(`Audio downloaded to ${localAudioPath}`);
      } catch (error) {
        console.error(`Failed to download audio: ${error.message}`);
        // Continue without audio if download fails
      }
    }

    // Create a new props file with the fixed properties
    const fixedPropsPath = path.join(
      path.dirname(process.argv[2]),
      `fixed-${path.basename(process.argv[2])}`,
    );
    await fs.writeFile(fixedPropsPath, JSON.stringify(fixedProps, null, 2));

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

module.exports = { renderVideoLocally };
