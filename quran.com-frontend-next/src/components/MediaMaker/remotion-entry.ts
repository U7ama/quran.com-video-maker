import { registerRoot } from 'remotion';

import { RemotionRoot } from './Root';

// Create a simplified version of Root that doesn't use Toast or other UI components
const SimplifiedRoot = () => {
  // Use a simplified version that doesn't depend on Next.js components
  return RemotionRoot();
};

registerRoot(SimplifiedRoot);
