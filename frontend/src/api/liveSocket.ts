export type LiveStreamHandlers<TMessage> = {
  onMessage: (message: TMessage) => void;
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (error: Error) => void;
};

/** `path` is the backend's `ws_url` (e.g. `/ws/sessions/s_8f2a`); `VITE_WS_URL` overrides the host. */
function resolveWebSocketUrl(path = "/ws"): URL {
  const configuredUrl = import.meta.env.VITE_WS_URL;
  const url = configuredUrl
    ? new URL(path, new URL(configuredUrl, window.location.href))
    : new URL(path, window.location.href);

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("The WebSocket URL must use ws:// or wss://.");
  }

  return url;
}

export type LiveStream<TOutgoing> = { send: (message: TOutgoing) => void; close: () => void };

export function connectLiveStream<TMessage, TOutgoing = never>(
  handlers: LiveStreamHandlers<TMessage>,
  path?: string,
): LiveStream<TOutgoing> {
  const socket = new WebSocket(resolveWebSocketUrl(path));

  socket.addEventListener("open", () => handlers.onOpen?.());
  socket.addEventListener("close", (event) => handlers.onClose?.(event));
  socket.addEventListener("error", () => {
    handlers.onError?.(new Error("The live data WebSocket connection failed."));
  });
  socket.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (typeof event.data !== "string") {
      handlers.onError?.(new Error("The live data stream must send JSON text messages."));
      return;
    }

    let message: TMessage;
    try {
      message = JSON.parse(event.data) as TMessage;
    } catch (error) {
      if (error instanceof SyntaxError) {
        handlers.onError?.(new Error("The live data stream sent invalid JSON."));
        return;
      }
      throw error;
    }

    handlers.onMessage(message);
  });

  return {
    send: (message) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    close: () => socket.close(1000, "Client closed the live data stream."),
  };
}
