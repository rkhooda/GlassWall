console.log("GLASSWALL background service worker loaded");

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
(chrome.runtime as unknown as { onInstalled: { addListener: (cb: () => void) => void } }).onInstalled.addListener(() => {
  console.log("GLASSWALL installed");
});