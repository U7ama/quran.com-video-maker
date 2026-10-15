export function renderedObjectKey(outputFile,bucket,renderId) {
  const output=new URL(outputFile);
  if(output.protocol!=='https:' || !output.hostname.endsWith('.amazonaws.com')) {
    throw new Error('Rendered output is outside the expected AWS storage');
  }
  let key=decodeURIComponent(output.pathname.slice(1));
  // Remotion may return either a virtual-hosted or path-style S3 URL.
  if(key.startsWith(`${bucket}/`))key=key.slice(bucket.length+1);
  if(!key.startsWith(`renders/${renderId}/`) || !key.endsWith('.mp4')) {
    throw new Error('Rendered output is outside the current render');
  }
  return key;
}
