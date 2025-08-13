import fs from 'fs/promises';
import path from 'path';

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET method
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { filename } = req.query;

    // Ensure filename is a string (it could be an array if used in query params multiple times)
    const filenameStr = Array.isArray(filename) ? filename[0] : filename;

    const videoPath = path.join(process.cwd(), 'tmp', filenameStr);

    // Check if file exists
    try {
      await fs.access(videoPath);
    } catch {
      return res.status(404).json({ error: 'Video file not found' });
    }

    // Read the video file
    const videoBuffer = await fs.readFile(videoPath);

    // Determine content type based on file extension
    const ext = path.extname(filenameStr).toLowerCase();
    let contentType = 'video/mp4'; // default

    if (ext === '.avi') contentType = 'video/x-msvideo';
    else if (ext === '.mov') contentType = 'video/quicktime';
    else if (ext === '.wmv') contentType = 'video/x-ms-wmv';
    else if (ext === '.flv') contentType = 'video/x-flv';
    else if (ext === '.webm') contentType = 'video/webm';
    else if (ext === '.mkv') contentType = 'video/x-matroska';

    // Set response headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');

    // Return the video file
    return res.send(videoBuffer);
  } catch (error) {
    console.error('Video serving error:', error);
    return res.status(500).json({
      error: 'Failed to serve video',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
