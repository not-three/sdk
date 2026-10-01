import { P2PSignaling } from './P2PSignaling';
import { P2PProtocol } from './P2PProtocol';
import { P2PConnectTimeoutError } from './P2PErrors';
import { RTCFactory } from '../types/sdk/P2P';

/**
 * The established peer connection and its open data channel.
 */
export interface P2PConnectResult {
  /** The peer connection, kept so the caller can close it. */
  pc: RTCPeerConnection;
  /** The open, reliable, ordered data channel carrying the transfer. */
  channel: RTCDataChannel;
  /** The negotiated SCTP max message size, or null when unknown. */
  maxMessageSize: number | null;
}

/** Options for {@link connectPeer}. */
export interface P2PConnectOptions {
  /** Which side of the handshake to perform. */
  role: 'sender' | 'receiver';
  /** An already connected and paired signaling client. */
  signaling: P2PSignaling;
  /** The factory creating the peer connection. */
  rtc: RTCFactory;
  /** The ICE servers handed out by the gateway. */
  iceServers: RTCIceServer[];
  /**
   * How long to wait for an open data channel.
   * @default P2PProtocol.CONNECT_TIMEOUT_MS
   */
  timeoutMs?: number;
}

interface SignalPayload {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

/**
 * Turn a paired signaling connection into an open WebRTC data channel.
 *
 * The sender creates the channel and the offer, the receiver answers and waits
 * for `ondatachannel`. Trickled ICE candidates are relayed through the
 * signaling client in both directions.
 * @param opts The connection options.
 * @throws P2PConnectTimeoutError If no channel opens within the timeout.
 * @returns The peer connection and its open data channel.
 * @category Lib
 */
export function connectPeer(opts: P2PConnectOptions): Promise<P2PConnectResult> {
  const timeoutMs = opts.timeoutMs ?? P2PProtocol.CONNECT_TIMEOUT_MS;
  const { signaling, role } = opts;
  const pc = opts.rtc({ iceServers: opts.iceServers });

  return new Promise<P2PConnectResult>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let remoteDescriptionReady = false;
    let drainingCandidates = false;
    const pendingCandidates: RTCIceCandidateInit[] = [];

    const finish = (error: Error | null, result?: P2PConnectResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // The callers re-take this handler for reconnects.
      signaling.onSignal = null;
      pc.onicecandidate = null;
      pc.ondatachannel = null;
      if (error) {
        try {
          pc.close();
        } catch {
          // The connection may already be gone.
        }
        reject(error);
      } else {
        resolve(result!);
      }
    };

    const ready = (channel: RTCDataChannel): void => {
      channel.binaryType = 'arraybuffer';
      const done = () =>
        finish(null, { pc, channel, maxMessageSize: pc.sctp?.maxMessageSize ?? null });
      if (channel.readyState === 'open') done();
      else
        channel.onopen = () => {
          channel.onopen = null;
          done();
        };
    };

    const drainCandidates = async (): Promise<void> => {
      if (!remoteDescriptionReady || drainingCandidates) return;
      drainingCandidates = true;
      try {
        while (pendingCandidates.length) await pc.addIceCandidate(pendingCandidates.shift()!);
      } finally {
        drainingCandidates = false;
      }
    };

    const handleSignal = async (payload: unknown): Promise<void> => {
      const signal = (payload ?? {}) as SignalPayload;
      if (signal.sdp) {
        await pc.setRemoteDescription(signal.sdp);
        remoteDescriptionReady = true;
        await drainCandidates();
        if (role === 'receiver') {
          await pc.setLocalDescription(await pc.createAnswer());
          signaling.sendSignal({ sdp: pc.localDescription });
        }
      } else if (signal.candidate) {
        pendingCandidates.push(signal.candidate);
        await drainCandidates();
      }
    };

    // Wire every handler before anything is sent, so no frame can be missed.
    signaling.onSignal = (payload) => {
      handleSignal(payload).catch((e) => finish(e as Error));
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) signaling.sendSignal({ candidate: ev.candidate });
    };
    if (role === 'receiver') pc.ondatachannel = (ev) => ready(ev.channel);

    timer = setTimeout(() => finish(new P2PConnectTimeoutError()), timeoutMs);

    if (role === 'sender') {
      const channel = pc.createDataChannel('file', { ordered: true });
      ready(channel);
      (async () => {
        await pc.setLocalDescription(await pc.createOffer());
        signaling.sendSignal({ sdp: pc.localDescription });
      })().catch((e) => finish(e as Error));
    }
  });
}
