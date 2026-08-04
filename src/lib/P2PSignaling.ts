import { p2pErrorFromGatewayCode } from './P2PErrors';

/**
 * The session details handed out by the gateway on `create`/`join`.
 * @category Lib
 */
export interface P2PSessionGrant {
  /** The id of the P2P session. */
  sessionId: string;
  /** The ICE servers to use for the WebRTC handshake. */
  iceServers: RTCIceServer[];
}

interface Pending {
  resolve: (value: P2PSessionGrant) => void;
  reject: (error: Error) => void;
  sessionId?: string;
}

interface GatewayMessage {
  type: string;
  sessionId?: string;
  iceServers?: RTCIceServer[];
  payload?: unknown;
  code?: string;
}

/**
 * A thin typed client for the API's `/p2p` signaling gateway.
 *
 * The `WebSocket` constructor is injected so this works in browsers and in
 * Node without pulling in a runtime dependency.
 * @category Lib
 * @see {@link P2PClient.gatewayUrl}
 */
export class P2PSignaling {
  /** Called for every relayed `signal` payload from the peer. */
  onSignal: ((payload: unknown) => void) | null = null;

  /** Called when a receiver joins the session. */
  onPeerJoined: (() => void) | null = null;

  /** Called when the peer leaves the session. */
  onPeerLeft: (() => void) | null = null;

  /** Called when the socket drops or the server reports an unsolicited error. */
  onClose: ((err?: Error) => void) | null = null;

  private ws: WebSocket | null = null;
  private pending: Pending | null = null;

  /**
   * Create a signaling client.
   * @param url The gateway URL.
   * @param webSocketCtor The WebSocket implementation to use.
   */
  constructor(
    private readonly url: string,
    private readonly webSocketCtor: typeof WebSocket,
  ) {}

  /**
   * Open the socket.
   * @returns A promise that resolves once the socket is open.
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new this.webSocketCtor(this.url);
      this.ws = ws;
      ws.onopen = () => {
        settled = true;
        resolve();
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Signaling connection failed'));
        }
      };
      ws.onclose = () => {
        this.ws = null;
        const error = new Error('Signaling connection closed');
        this.pending?.reject(error);
        if (!settled) {
          settled = true;
          reject(error);
          return;
        }
        this.onClose?.();
      };
      ws.onmessage = (ev: MessageEvent) => this.handle(String(ev.data));
    });
  }

  private handle(raw: string): void {
    let msg: GatewayMessage;
    try {
      msg = JSON.parse(raw) as GatewayMessage;
    } catch {
      const error = new Error('Malformed signaling message');
      this.close();
      this.onClose?.(error);
      return;
    }
    switch (msg.type) {
      case 'created':
        this.pending?.resolve({ sessionId: msg.sessionId ?? '', iceServers: msg.iceServers ?? [] });
        break;
      case 'joined': {
        const sessionId = this.pending?.sessionId ?? msg.sessionId ?? '';
        this.pending?.resolve({ sessionId, iceServers: msg.iceServers ?? [] });
        break;
      }
      case 'error': {
        const error = p2pErrorFromGatewayCode(msg.code ?? 'invalid-message');
        if (this.pending) this.pending.reject(error);
        else this.onClose?.(error);
        break;
      }
      case 'signal':
        this.onSignal?.(msg.payload);
        break;
      case 'peer-joined':
        this.onPeerJoined?.();
        break;
      case 'peer-left':
        this.onPeerLeft?.();
        break;
    }
  }

  /**
   * Create a new session as the sender.
   * @returns The session grant.
   */
  create(): Promise<P2PSessionGrant> {
    return this.request({ type: 'create' });
  }

  /**
   * Join an existing session as the receiver.
   * @param sessionId The session to join.
   * @returns The session grant.
   */
  join(sessionId: string): Promise<P2PSessionGrant> {
    return this.request({ type: 'join', sessionId }, sessionId);
  }

  private request(frame: object, sessionId?: string): Promise<P2PSessionGrant> {
    if (this.pending) return Promise.reject(new Error('Another signaling request is in flight'));
    return new Promise<P2PSessionGrant>((resolve, reject) => {
      this.pending = {
        resolve: (value) => {
          this.pending = null;
          resolve(value);
        },
        reject: (error) => {
          this.pending = null;
          reject(error);
        },
        sessionId,
      };
      try {
        this.send(frame);
      } catch (e) {
        this.pending?.reject(e as Error);
      }
    });
  }

  /**
   * Relay an opaque WebRTC signaling payload to the peer.
   * @param payload The payload to relay.
   * @throws Error If the socket is not open.
   */
  sendSignal(payload: unknown): void {
    this.send({ type: 'signal', payload });
  }

  /**
   * Leave the session and close the socket.
   */
  leave(): void {
    try {
      this.send({ type: 'leave' });
    } catch {
      // Best effort: the socket may already be gone.
    } finally {
      this.close();
    }
  }

  /**
   * Close the socket without notifying {@link onClose}.
   */
  close(): void {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    ws.onclose = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.close();
  }

  private send(frame: object): void {
    if (!this.ws || this.ws.readyState !== 1) throw new Error('Signaling socket not open');
    this.ws.send(JSON.stringify(frame));
  }
}
