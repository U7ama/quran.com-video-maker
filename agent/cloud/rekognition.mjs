import {RekognitionClient,DetectLabelsCommand,DetectModerationLabelsCommand,DetectTextCommand} from '@aws-sdk/client-rekognition';

const client=new RekognitionClient({region:'us-east-1',maxAttempts:2});
export async function analyzeFrame(bytes) {
  const Image={Bytes:bytes};
  const options={abortSignal:AbortSignal.timeout(20000)};
  const [labels,moderation,text]=await Promise.all([
    client.send(new DetectLabelsCommand({Image,MinConfidence:60,MaxLabels:100,Features:['GENERAL_LABELS']}),options),
    client.send(new DetectModerationLabelsCommand({Image,MinConfidence:50}),options),
    client.send(new DetectTextCommand({Image,Filters:{WordFilter:{MinConfidence:70}}}),options),
  ]);
  return {labels,moderation,text};
}
