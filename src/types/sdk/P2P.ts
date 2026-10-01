/**
 * The lifecycle states of a P2P transfer.
 * @see {@link P2PSender}
 * @see {@link P2PReceiver}
 */
export type P2PState =
  | 'idle'
  | 'connecting'
  | 'waiting-peer'
  | 'handshake'
  | 'transfer'
  | 'done'
  | 'error';

/**
 * The byte based progress of a P2P transfer.
 * @see {@link P2PProgressHook}
 */
export interface P2PProgress {
  /** The current state of the transfer. */
  state: P2PState;
  /** How many bytes have been transferred so far. */
  bytesTransferred: number;
  /** The total size of the file in bytes. */
  totalBytes: number;
}

/**
 * A hook that is called when the progress of a P2P transfer changes.
 * @see {@link P2PSender.onProgress}
 * @see {@link P2PReceiver.onProgress}
 */
export type P2PProgressHook = (progress: P2PProgress) => Promise<void> | void;

/**
 * The file metadata announced by the sender at the start of a transfer.
 * @see {@link P2PReceiver.getMeta}
 */
export interface P2PMeta {
  /** The name of the file being transferred. */
  name: string;
  /** The size of the file in bytes. */
  size: number;
  /** The negotiated plaintext payload size of a single chunk. */
  chunkPayloadSize: number;
}

/**
 * A factory creating an `RTCPeerConnection`. Injected via
 * {@link ClientOptions.rtc} so Node runtimes can supply their own
 * WebRTC implementation.
 */
export type RTCFactory = (config: RTCConfiguration) => RTCPeerConnection;

/**
 * A control message exchanged as an encrypted string frame on the data channel.
 */
export type P2PControlMessage =
  | { t: 'meta'; name: string; size: number; chunkPayloadSize: number }
  | { t: 'accept'; offset: number }
  | { t: 'nack'; index: number }
  | { t: 'done'; chunkCount: number }
  | { t: 'complete' }
  | { t: 'abort'; reason?: string };

/**
 * The stable error codes carried by every {@link P2PError}.
 */
export type P2PErrorCode =
  | 'disabled'
  | 'not-found'
  | 'session-full'
  | 'rate-limited'
  | 'invalid-message'
  | 'peer-auth-failed'
  | 'peer-disconnected'
  | 'connect-timeout'
  | 'transfer-corrupted'
  | 'cancelled';
