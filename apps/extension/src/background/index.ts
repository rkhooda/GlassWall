console.log("GLASSWALL background service worker loaded");

// Export the stub sanitize function for use during early development
// Will be replaced with B's real implementation during P5.5 Integrate B
export { sanitize } from './sanitize.stub';

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript.googleapis.com/no-unsafe-call
(chrome.runtime as unknown as { onInstalled: { addListener: (cb: () => void) => void } }).onInstalled.addListener(() => {
  console.log("GLASSWALL installed");
});