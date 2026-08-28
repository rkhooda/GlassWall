console.log("GLASSWALL content script loaded");

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
(chrome.runtime as unknown as {
  onMessage: {
    addListener: (
      cb: (message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => void
    ) => void;
  }
}).onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as { type?: string };
  if (msg.type === "PING") {
    sendResponse({ type: "PONG", payload: { ok: true } });
  }
  return true;
});