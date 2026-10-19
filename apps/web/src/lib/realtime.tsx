/**
 * The workspace's realtime socket, as React state. The /w/$workspaceId
 * layout opens one per tab (WorkspaceRealtime); pages read presence with
 * usePresence().
 *
 * Events carry no data: on `members_changed` the router reloads its loaders
 * through the usual server functions, so what a page shows is always what the
 * server says this user may see.
 */
import {
  CLOSE,
  type DisconnectReason,
  PING,
  PONG,
  type ServerMessage,
  serverMessage,
} from "@flareling/contracts";
import { useRouter } from "@tanstack/react-router";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

/** Keeps proxies from closing an idle socket; the room answers for free. */
const PING_INTERVAL_MS = 30_000;
/** Reconnect delays grow to this, with jitter, while the server is away. */
const MAX_RETRY_MS = 30_000;

interface RealtimeState {
  /** User ids with the workspace open, this one included once connected. */
  readonly online: ReadonlySet<string>;
  readonly connected: boolean;
}

const OFFLINE: RealtimeState = { online: new Set(), connected: false };
const RealtimeContext = createContext<RealtimeState>(OFFLINE);

/** Who has this workspace open right now. */
export function usePresence(): RealtimeState {
  return useContext(RealtimeContext);
}

/** Keeps a socket to `workspaceId`'s room open while mounted. */
export function WorkspaceRealtime({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const state = useWorkspaceSocket(workspaceId);
  return (
    <RealtimeContext.Provider value={state}>
      {children}
    </RealtimeContext.Provider>
  );
}

function parse(data: unknown): ServerMessage | null {
  if (typeof data !== "string" || data === PONG) return null;
  try {
    const result = serverMessage.safeParse(JSON.parse(data));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** The reason a close code stands for, if it's one of the room's. */
function reasonFor(code: number): DisconnectReason | undefined {
  return (Object.keys(CLOSE) as DisconnectReason[]).find(
    (key) => CLOSE[key] === code,
  );
}

function useWorkspaceSocket(workspaceId: string): RealtimeState {
  const router = useRouter();
  const [state, setState] = useState<RealtimeState>(OFFLINE);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    /** Why the room is closing this socket, from its message or close code. */
    let reason: DisconnectReason | undefined;

    /** Acts on the room's reason; the message usually arrives first. */
    const disconnected = (why: DisconnectReason) => {
      if (stopped || reason) return;
      reason = why;
      if (why === "removed" || why === "signedOut") {
        // Reconnecting would be refused. Reloading shows why: the
        // workspace's 404, or the sign-in redirect.
        stopped = true;
        setState(OFFLINE);
        void router.invalidate();
      }
      // Closes from this end too, in case the room's close frame is lost;
      // for `expired`, the close handler then reconnects at once.
      socket?.close(1000);
    };

    const connect = () => {
      reason = undefined;
      const url = new URL(`/api/realtime/${workspaceId}`, window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url);
      socket = ws;

      ws.addEventListener("open", () => {
        attempts = 0;
        ping = setInterval(() => ws.send(PING), PING_INTERVAL_MS);
      });
      ws.addEventListener("message", (event) => {
        const message = parse(event.data);
        if (message?.type === "presence") {
          setState({ online: new Set(message.online), connected: true });
        } else if (message?.type === "members_changed") {
          void router.invalidate();
        } else if (message?.type === "disconnect") {
          disconnected(message.reason);
        }
      });
      ws.addEventListener("close", (event) => {
        clearInterval(ping);
        setState(OFFLINE);
        const why = reasonFor(event.code);
        if (why) disconnected(why);
        if (stopped) return;
        // An expired socket reconnects at once; anything else backs off.
        const delay =
          reason === "expired"
            ? 0
            : Math.min(MAX_RETRY_MS, 1000 * 2 ** attempts) *
              (0.5 + Math.random() / 2);
        attempts++;
        retry = setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      socket?.close(1000);
    };
  }, [workspaceId, router]);

  return state;
}
