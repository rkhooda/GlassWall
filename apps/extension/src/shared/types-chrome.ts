// Chrome types extension for content script and background
// This is a simplified version for the skeleton implementation

declare global {
  interface Window {
    chrome: Chrome;
  }

  interface Chrome {
    runtime: ChromeRuntime;
  }

  interface ChromeRuntime {
    onMessage: ChromeEvent<
      (message: any, sender: ChromeMessageSender, sendSendResponse: (response?: any) => void) => boolean | void
    >;
    onConnectExternal: ChromeEvent<(port: MessagePort) => void>;
    sendMessage: (message: any, responseCallback?: (response: any) => void) => void;
    getURL: (path: string) => string;
  }

  interface ChromeMessageSender {
    id?: string;
    url?: string;
    tab?: { id: number; index: number; windowId: number };
  }

  interface ChromeEvent<T extends Function> {
    addListener: (callback: T) => void;
    removeListener: (callback: T) => void;
    hasListener: (callback: T) => boolean;
  }

  interface MessagePort {
    postMessage: (message: any) => void;
    onMessage: ChromeEvent<(message: any) => void>;
    onDisconnect: ChromeEvent<() => void>;
    disconnect: () => void;
  }
}

// For content scripts, we can access chrome directly
// For background/service worker, chrome is available globally

export {};