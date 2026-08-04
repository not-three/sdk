import { P2PClient } from '../clients/P2P';
import { SetBytesFn } from '../types/sdk/SetBytesFn';
import { P2PControlMessage, P2PMeta, P2PProgress, P2PProgressHook, P2PState } from '../types/sdk/P2P';
import { Crypto } from './Crypto';
import { P2PProtocol } from './P2PProtocol';
import { P2PSignaling } from './P2PSignaling';
import { connectPeer } from './P2PConnection';
import {
  P2PCancelledError,
  P2PConnectTimeoutError,
  P2PPeerAuthFailedError,
  P2PPeerDisconnectedError,
  P2PTransferCorruptedError,
} from './P2PErrors';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Normalize whatever the data channel hands us into a plain ArrayBuffer. */
function toArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  throw new Error('Unsupported binary frame type on the data channel');
}

/**
 * Receives a single file from a {@link P2PSender} over a WebRTC data channel.
 *
 * Every frame is decrypted and sequence-checked as it arrives, so validation
 * finishes the instant the last chunk lands. Failed chunks are re-requested
 * (`nack`) and the sender rewinds, which keeps writes strictly sequential — a
 * requirement for streaming sinks. Memory stays bounded: a chunk is written
 * through `setBytes` before the next one is processed.
 *
 * On any unrecoverable failure the partial data already handed to `setBytes`
 * stays intact; resume by constructing a fresh receiver and passing the
 * validated byte count as `resumeOffset`.
 * @category Lib
 * @see {@link P2PSender}
 */
export class P2PReceiver {
  private progressHook: P2PProgressHook | null = null;
  private progress: P2PProgress = { state: 'idle', bytesTransferred: 0, totalBytes: 0 };
  private readonly metaDeferred = deferred<P2PMeta>();
  private readonly startDeferred = deferred<void>();

  private signaling: P2PSignaling | null = null;
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private key: CryptoKey | null = null;
  private meta: P2PMeta | null = null;
  private setBytes: SetBytesFn | null = null;

  private resumeOffset = 0;
  private startOffset = 0;
  private expectedIndex = 0;
  private receivedBytes = 0;
  private readonly nackCounts = new Map<number, number>();
  private queue: Promise<void> = Promise.resolve();
  private controlTimer: ReturnType<typeof setTimeout> | null = null;

  private started = false;
  private settled = false;
  private cancelled = false;

  /**
   * Create a receiver for a shared P2P session.
   * @param p2p The P2P sub-client of a configured {@link Not3Client}.
   * @param sessionId The session id from the share link.
   * @param seed The encryption seed from the share link fragment.
   */
  constructor(
    private readonly p2p: P2PClient,
    private readonly sessionId: string,
    private readonly seed: string,
  ) {
    // Nobody may have called getMeta() yet; keep a failed handshake from
    // surfacing as an unhandled rejection.
    void this.metaDeferred.promise.catch(() => {});
  }

  /**
   * Set a hook that is called whenever the transfer progress changes.
   * @param hook The hook to call.
   */
  onProgress(hook: P2PProgressHook): void {
    this.progressHook = hook;
  }

  /**
   * Get the current progress of the transfer.
   * @returns The progress snapshot.
   */
  getProgress(): P2PProgress {
    return { ...this.progress };
  }

  /**
   * The file metadata announced by the sender.
   * @returns A promise resolving once the `meta` message decrypted, and
   * rejecting if the transfer fails before that.
   */
  getMeta(): Promise<P2PMeta> {
    return this.metaDeferred.promise;
  }

  /**
   * Join the session and receive the file.
   * @param setBytes The sink for validated, decrypted chunks. Called strictly
   * in order; the returned promise is awaited before the next chunk is read.
   * @param resumeOffset How many bytes the sink already holds. Rounded down to
   * the previous chunk boundary.
   * @returns A promise resolving once the sender confirmed the transfer.
   */
  async start(setBytes: SetBytesFn, resumeOffset = 0): Promise<void> {
    if (this.started) throw new Error('Transfer already started');
    this.started = true;
    this.setBytes = setBytes;
    this.resumeOffset = resumeOffset;
    try {
      await this.run();
    } catch (e) {
      this.fail(e as Error);
    }
    return this.startDeferred.promise;
  }

  /**
   * Cancel the transfer, telling the peer about it.
   * @returns A promise resolving once the abort was attempted.
   */
  async cancel(): Promise<void> {
    if (this.settled) return;
    this.cancelled = true;
    await this.trySendControl({ t: 'abort', reason: 'cancelled' });
    this.fail(new P2PCancelledError());
  }

  private async run(): Promise<void> {
    this.setState('connecting');
    this.key = await Crypto.generateKey(this.seed, 'gcm');

    const signaling = new P2PSignaling(this.p2p.gatewayUrl(), this.p2p.webSocketCtor());
    this.signaling = signaling;
    signaling.onClose = () => this.fail(new P2PPeerDisconnectedError());
    signaling.onPeerLeft = () => this.fail(new P2PPeerDisconnectedError());
    await signaling.connect();
    const grant = await signaling.join(this.sessionId);
    if (this.cancelled) throw new P2PCancelledError();

    this.setState('handshake');
    const { pc, channel } = await connectPeer({
      role: 'receiver',
      signaling,
      rtc: this.p2p.rtcFactory(),
      iceServers: grant.iceServers,
    });
    this.pc = pc;
    this.channel = channel;
    channel.onmessage = (ev: MessageEvent) => this.enqueue(ev.data);
    channel.onclose = () => this.fail(new P2PPeerDisconnectedError());

    // The peer must produce a meta message that decrypts under our seed.
    this.controlTimer = setTimeout(
      () => this.fail(new P2PConnectTimeoutError()),
      P2PProtocol.CONTROL_TIMEOUT_MS,
    );
  }

  private enqueue(data: unknown): void {
    this.queue = this.queue
      .then(() => this.handleFrame(data))
      .catch((e) => this.fail(e as Error));
  }

  private async handleFrame(data: unknown): Promise<void> {
    if (this.settled) return;
    if (typeof data === 'string') await this.handleControl(data);
    else await this.handleChunk(toArrayBuffer(data));
  }

  private async handleControl(raw: string): Promise<void> {
    let msg: P2PControlMessage;
    try {
      msg = await P2PProtocol.decryptControl(raw, this.key!);
    } catch {
      // The first frame is the peer's proof it holds the seed.
      if (!this.meta) this.fail(new P2PPeerAuthFailedError());
      return;
    }
    switch (msg.t) {
      case 'meta':
        await this.onMeta(msg);
        break;
      case 'done':
        await this.onDone(msg.chunkCount);
        break;
      case 'abort':
        this.fail(
          msg.reason === 'cancelled' ? new P2PCancelledError() : new P2PPeerDisconnectedError(),
        );
        break;
    }
  }

  private async onMeta(msg: P2PMeta & { t: 'meta' }): Promise<void> {
    if (this.meta) return;
    if (this.controlTimer) {
      clearTimeout(this.controlTimer);
      this.controlTimer = null;
    }
    const meta: P2PMeta = {
      name: msg.name,
      size: msg.size,
      chunkPayloadSize: msg.chunkPayloadSize,
    };
    this.meta = meta;
    this.metaDeferred.resolve(meta);

    const offset = Math.min(Math.max(this.resumeOffset, 0), meta.size);
    this.startOffset = Math.floor(offset / meta.chunkPayloadSize) * meta.chunkPayloadSize;
    this.expectedIndex = this.startOffset / meta.chunkPayloadSize;
    this.progress.totalBytes = meta.size;
    this.progress.bytesTransferred = this.startOffset;

    await this.sendControl({ t: 'accept', offset: this.startOffset });
    this.setState('transfer');
  }

  private async handleChunk(data: ArrayBuffer): Promise<void> {
    if (!this.meta) return;
    let chunk: { index: number; payload: ArrayBuffer };
    try {
      chunk = await P2PProtocol.decryptChunk(data, this.key!);
    } catch {
      await this.nack(this.expectedIndex);
      return;
    }
    // Frames from before a rewind are stale; anything ahead means a gap.
    if (chunk.index < this.expectedIndex) return;
    if (chunk.index > this.expectedIndex) {
      await this.nack(this.expectedIndex);
      return;
    }
    await this.setBytes!(chunk.payload, chunk.index);
    this.expectedIndex++;
    this.receivedBytes += chunk.payload.byteLength;
    this.progress.bytesTransferred = this.startOffset + this.receivedBytes;
    await this.emitProgress();
  }

  private async nack(index: number): Promise<void> {
    const count = (this.nackCounts.get(index) ?? 0) + 1;
    this.nackCounts.set(index, count);
    if (count > P2PProtocol.NACK_RETRY_LIMIT) {
      this.fail(new P2PTransferCorruptedError());
      return;
    }
    await this.sendControl({ t: 'nack', index });
  }

  private async onDone(chunkCount: number): Promise<void> {
    if (!this.meta) return;
    if (this.expectedIndex < chunkCount) {
      // Chunks are missing: ask for the rewind, the sender will re-announce.
      await this.nack(this.expectedIndex);
      return;
    }
    if (this.receivedBytes !== this.meta.size - this.startOffset) {
      this.fail(new P2PTransferCorruptedError());
      return;
    }
    await this.sendControl({ t: 'complete' });
    this.setState('done');
    await this.emitProgress();
    this.finish();
  }

  private async sendControl(msg: P2PControlMessage): Promise<void> {
    if (!this.channel || this.channel.readyState !== 'open') {
      throw new P2PPeerDisconnectedError();
    }
    this.channel.send(await P2PProtocol.encryptControl(msg, this.key!));
  }

  private async trySendControl(msg: P2PControlMessage): Promise<void> {
    try {
      await this.sendControl(msg);
    } catch {
      // Best effort: the channel may already be gone.
    }
  }

  private setState(state: P2PState): void {
    this.progress.state = state;
    void this.emitProgress();
  }

  private async emitProgress(): Promise<void> {
    if (!this.progressHook) return;
    await this.progressHook({ ...this.progress });
  }

  private cleanup(): void {
    if (this.controlTimer) {
      clearTimeout(this.controlTimer);
      this.controlTimer = null;
    }
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.onclose = null;
      try {
        this.channel.close();
      } catch {
        // Already gone.
      }
      this.channel = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        // Already gone.
      }
      this.pc = null;
    }
    if (this.signaling) {
      this.signaling.onClose = null;
      this.signaling.onPeerLeft = null;
      this.signaling.leave();
      this.signaling = null;
    }
  }

  private finish(): void {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    this.startDeferred.resolve();
  }

  private fail(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.progress.state = 'error';
    void this.emitProgress();
    this.metaDeferred.reject(error);
    this.cleanup();
    this.startDeferred.reject(error);
  }
}
