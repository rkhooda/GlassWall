// Chrome types extension for content script and background
// This is a simplified version for the skeleton implementation

declare global {
  interface Window {
    chrome: typeof chrome;
  }

  // For content scripts, we can access chrome directly
  // For background/service worker, chrome is available globally
}

export {};