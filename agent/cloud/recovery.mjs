export function retryFailedRender(state,progress,now=Date.now()) {
  if(state.status!=='render-error' || state.attemptedAt || state.messageId || state.channelId ||
      state.deliveredAt || state.masterKey || state.uploadKey || progress.postRenderData ||
      progress.combinedFrames!==0 || !Array.isArray(progress.receivedArtifact) || progress.receivedArtifact.length ||
      !Array.isArray(progress.chunks) || !Number.isInteger(progress.renderMetadata?.totalChunks) ||
      progress.chunks.length>=progress.renderMetadata.totalChunks ||
      !state.renderId || !state.selection || !Number.isFinite(progress.timeoutTimestamp) ||
      progress.timeoutTimestamp>=now || (state.renderRepairAttempts || 0)>=1) {
    throw new Error('Cloud render recovery requires an expired, unsent render with no completed master');
  }
  return {...state,status:'preparing',error:null,renderRepairAttempts:1,
    previousRenderIds:[...(state.previousRenderIds || []),state.renderId],
    repairedAt:new Date(now).toISOString(),repair:'Expired unsent render restarted with cloud background decoding fix'};
}
