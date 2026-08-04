import { P2PClient } from '../clients/P2P';
import { GetBytesFn } from '../types/sdk/GetBytesFn';
import { P2PControlMessage, P2PProgress, P2PProgressHook, P2PState } from '../types/sdk/P2P';
import { Crypto } from './Crypto';
import { P2PProtocol } from './P2PProtocol';
import { P2PSignaling } from './P2PSignaling';
import { connectPeer, P2PConnectResult } from './P2PConnection';
import {
  P2PCancelledError,
  P2PPeerDisconnectedError,
  P2PTransferCorruptedError,
} from './P2PErrors';

/** The outcome of serving one paired peer. */
type ServeResult = 'complete' | 'retry';

/** Everything that lives for exactly one paired peer. */
interface PeerSession {
  wake: (() => void) | null;
  woken: boolean;
  drainResolve: (() => void) | null;
  nextChunk: number;
  chunkCount: number;
  chunkPayloadSize: number;
  nackCounts: Map<number, number>;
  accepted: boolean;
  acceptTimedOut: boolean;
  authFailed: boolean;
  completed: boolean;
  dead: boolean;
  error: Error | null;
  queue: Promise<void>;
}

/**
 * Sends a single file of any size to a {@link P2PReceiver} over a WebRTC data
 * channel, end-to-end encrypted with a seed the server never sees.
 *
 * The session outlives a single peer: if the channel dies or a joiner cannot
 * prove it holds the seed, the sender drops that peer and waits for the next
 * one, which lets a receiver re-join and resume from its validated offset.
 * Memory stays bounded — one chunk is read through `getBytes` at a time and
 * sending pauses whenever the channel's send buffer fills up.
 * @category Lib
 * @see {@link P2PReceiver}
 * @see {@link ShareGenerator.p2pUi}
 */
export class P2PSender {
  private readonly seed: string;
  private progressHook: P2PProgressHook | null = null;
  private progress: P2PProgress = { state: 'idle', bytesTransferred: 0, totalBytes: 0 };

  private readonly startPromise: Promise<void>;
  private resolveStart!: () => void;
  private rejectStart!: (error: Error) => void;

  private signaling: P2PSignaling | null = null;
  private conn: P2PConnectResult | null = null;
  private session: PeerSession | null = null;
  private key: CryptoKey | null = null;
  private sessionId: string | null = null;
  private iceServers: RTCIceServer[] = [];

  private started = false;
  private settled = false;
  private failure: Error | null = null;

  private peerPresent = false;
  private peerGeneration = 0;
  private servedGeneration = -1;
  private peerWaiter: (() => void) | null = null;

  /**
   * Create a sender for a single file.
   * @param p2p The P2P sub-client of a configured {@link Not3Client}.
   * @param name The file name announced to the receiver (encrypted on the wire).
   * @param size The file size in bytes.
   * @param opts.seed Reuse a seed to restart a broken transfer in a new session.
   */
  constructor(
    private readonly p2p: P2PClient,
    private readonly name: string,
    private readonly size: number,
    opts?: { seed?: string },
  ) {
    this.seed = opts?.seed ?? Crypto.generateSeed();
    this.progress.totalBytes = size;
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
  }

  /**
   * Get the seed the file is encrypted with. Needed to build the share link.
   * @returns The seed, handle with care.
   */
  getSeed(): string {
    return this.seed;
  }

  /**
   * Get the id of the created session.
   * @throws Error If the session was not created yet.
   * @returns The session id.
   */
  getSessionId(): string {
    if (!this.sessionId) throw new Error('Transfer not started');
    return this.sessionId;
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
   * Create the session and serve the file to whoever joins with the seed.
   * @param getBytes The source of file bytes.
   * @throws Error If the transfer was already started.
   * @returns A promise resolving once a receiver confirmed the full transfer.
   */
  async start(getBytes: GetBytesFn): Promise<void> {
    if (this.started) throw new Error('Transfer already started');
    this.started = true;
    void this.run(getBytes).then(
      () => this.finish(),
      (e) => this.fail(e as Error),
    );
    return this.startPromise;
  }

  /**
   * Cancel the transfer, telling a connected peer about it.
   * @returns A promise resolving once the abort was attempted.
   */
  async cancel(): Promise<void> {
    if (this.settled) return;
    await this.trySendControl({ t: 'abort', reason: 'cancelled' });
    this.fail(new P2PCancelledError());
  }

  private async run(getBytes: GetBytesFn): Promise<void> {
    this.setState('connecting');
    this.key = await Crypto.generateKey(this.seed, 'gcm');

    const signaling = new P2PSignaling(this.p2p.gatewayUrl(), this.p2p.webSocketCtor());
    this.signaling = signaling;
    signaling.onClose = () => this.fail(new P2PPeerDisconnectedError());
    signaling.onPeerJoined = () => {
      this.peerGeneration++;
      this.peerPresent = true;
      const waiter = this.peerWaiter;
      this.peerWaiter = null;
      waiter?.();
    };
    signaling.onPeerLeft = () => {
      this.peerPresent = false;
      this.markDead();
    };
    await signaling.connect();
    const grant = await signaling.create();
    this.sessionId = grant.sessionId;
    this.iceServers = grant.iceServers;

    for (;;) {
      this.throwIfSettled();
      this.setState('waiting-peer');
      await this.waitForPeer();
      this.throwIfSettled();

      this.setState('handshake');
      const conn = await connectPeer({
        role: 'sender',
        signaling,
        rtc: this.p2p.rtcFactory(),
        iceServers: this.iceServers,
      });
      this.conn = conn;

      let result: ServeResult;
      try {
        result = await this.serve(conn, getBytes);
      } finally {
        this.closeConnection();
      }
      if (result === 'complete') return;
      // The peer we just served is gone; wait for a fresh one to join.
      if (this.servedGeneration === this.peerGeneration) this.peerPresent = false;
    }
  }

  private throwIfSettled(): void {
    if (this.settled) throw this.failure ?? new P2PCancelledError();
  }

  private waitForPeer(): Promise<void> {
    if (this.peerPresent) {
      this.servedGeneration = this.peerGeneration;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.peerWaiter = () => {
        this.servedGeneration = this.peerGeneration;
        resolve();
      };
    });
  }

  private async serve(conn: P2PConnectResult, getBytes: GetBytesFn): Promise<ServeResult> {
    const { channel } = conn;
    const chunkPayloadSize = P2PProtocol.chunkPayloadSize(conn.maxMessageSize);
    const s: PeerSession = {
      wake: null,
      woken: false,
      drainResolve: null,
      nextChunk: 0,
      chunkCount: P2PProtocol.chunkCount(this.size, chunkPayloadSize),
      chunkPayloadSize,
      nackCounts: new Map(),
      accepted: false,
      acceptTimedOut: false,
      authFailed: false,
      completed: false,
      dead: false,
      error: null,
      queue: Promise.resolve(),
    };
    this.session = s;

    channel.onmessage = (ev: MessageEvent) => {
      s.queue = s.queue.then(() => this.handleControl(String(ev.data), s));
    };
    channel.onclose = () => this.markDead();

    await this.sendControl({
      t: 'meta',
      name: this.name,
      size: this.size,
      chunkPayloadSize,
    });

    await this.waitForAccept(s);
    await this.drain(s);
    if (s.error) throw s.error;
    // A joiner that cannot speak the seed is dropped; the session survives.
    if (!s.accepted) return 'retry';

    this.progress.bytesTransferred = s.nextChunk * chunkPayloadSize;
    this.setState('transfer');

    for (;;) {
      while (s.nextChunk < s.chunkCount) {
        if (s.error) throw s.error;
        if (s.dead) return this.onDead(s);
        const index = s.nextChunk;
        const start = index * chunkPayloadSize;
        const end = Math.min(start + chunkPayloadSize, this.size);
        const encrypted = await P2PProtocol.encryptChunk(
          index,
          await getBytes(start, end),
          this.key!,
        );
        await this.waitDrain(channel, s);
        if (s.error) throw s.error;
        if (s.dead) return this.onDead(s);
        // A nack may have rewound us while we were reading and encrypting.
        if (s.nextChunk !== index) continue;
        channel.send(encrypted);
        s.nextChunk = index + 1;
        this.progress.bytesTransferred = end;
        await this.emitProgress();
      }

      await this.sendControl({ t: 'done', chunkCount: s.chunkCount });
      await this.park(s);
      await this.drain(s);
      if (s.error) throw s.error;
      if (s.completed) return 'complete';
      if (s.dead) return 'retry';
      // Otherwise a nack rewound us: stream the missing range again.
    }
  }

  /**
   * A dead channel is only the end of the story once every frame that was
   * already in flight has been decrypted — the peer's parting `abort` or
   * `complete` routinely races its own channel close.
   */
  private async onDead(s: PeerSession): Promise<ServeResult> {
    await this.drain(s);
    if (s.error) throw s.error;
    if (s.completed) return 'complete';
    return 'retry';
  }

  /** Wait for every control frame received so far to finish being handled. */
  private async drain(s: PeerSession): Promise<void> {
    await s.queue;
  }

  private async handleControl(raw: string, s: PeerSession): Promise<void> {
    let msg: P2PControlMessage;
    try {
      msg = await P2PProtocol.decryptControl(raw, this.key!);
    } catch {
      // The joiner's first message is its proof that it holds the seed.
      if (!s.accepted) {
        s.authFailed = true;
        this.wake(s);
      }
      return;
    }
    switch (msg.t) {
      case 'accept':
        if (s.accepted) break;
        s.accepted = true;
        s.nextChunk = Math.floor(Math.max(msg.offset, 0) / s.chunkPayloadSize);
        this.wake(s);
        break;
      case 'nack': {
        if (msg.index < 0 || msg.index >= s.chunkCount) break;
        const count = (s.nackCounts.get(msg.index) ?? 0) + 1;
        s.nackCounts.set(msg.index, count);
        if (count > P2PProtocol.NACK_RETRY_LIMIT) {
          await this.trySendControl({ t: 'abort', reason: 'corrupted' });
          s.error = new P2PTransferCorruptedError();
        } else {
          s.nextChunk = Math.min(s.nextChunk, msg.index);
        }
        this.wake(s);
        break;
      }
      case 'complete':
        s.completed = true;
        this.wake(s);
        break;
      case 'abort':
        s.error =
          msg.reason === 'cancelled' ? new P2PCancelledError() : new P2PPeerDisconnectedError();
        this.wake(s);
        break;
    }
  }

  private async waitForAccept(s: PeerSession): Promise<void> {
    const settled = () => s.accepted || s.authFailed || s.dead || s.acceptTimedOut || !!s.error;
    if (settled()) return;
    const timer = setTimeout(() => {
      s.acceptTimedOut = true;
      this.wake(s);
    }, P2PProtocol.CONTROL_TIMEOUT_MS);
    try {
      while (!settled()) await this.park(s);
    } finally {
      clearTimeout(timer);
    }
  }

  private waitDrain(channel: RTCDataChannel, s: PeerSession): Promise<void> {
    if (channel.bufferedAmount <= P2PProtocol.BUFFER_HIGH_WATER) return Promise.resolve();
    channel.bufferedAmountLowThreshold = P2PProtocol.BUFFER_LOW_WATER;
    return new Promise<void>((resolve) => {
      s.drainResolve = () => {
        s.drainResolve = null;
        channel.onbufferedamountlow = null;
        resolve();
      };
      channel.onbufferedamountlow = () => s.drainResolve?.();
    });
  }

  private park(s: PeerSession): Promise<void> {
    if (s.woken) {
      s.woken = false;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      s.wake = resolve;
    });
  }

  private wake(s: PeerSession): void {
    s.drainResolve?.();
    const waiter = s.wake;
    s.wake = null;
    if (waiter) waiter();
    else s.woken = true;
  }

  private markDead(): void {
    const s = this.session;
    if (!s) return;
    s.dead = true;
    this.wake(s);
  }

  private async sendControl(msg: P2PControlMessage): Promise<void> {
    const channel = this.conn?.channel;
    if (!channel || channel.readyState !== 'open') throw new P2PPeerDisconnectedError();
    channel.send(await P2PProtocol.encryptControl(msg, this.key!));
  }

  private async trySendControl(msg: P2PControlMessage): Promise<void> {
    try {
      await this.sendControl(msg);
    } catch {
      // Best effort: the channel may already be gone.
    }
  }

  private closeConnection(): void {
    const conn = this.conn;
    this.session = null;
    this.conn = null;
    if (!conn) return;
    conn.channel.onmessage = null;
    conn.channel.onclose = null;
    conn.channel.onbufferedamountlow = null;
    try {
      conn.channel.close();
    } catch {
      // Already gone.
    }
    try {
      conn.pc.close();
    } catch {
      // Already gone.
    }
  }

  private closeSignaling(): void {
    if (!this.signaling) return;
    this.signaling.onClose = null;
    this.signaling.onPeerLeft = null;
    this.signaling.onPeerJoined = null;
    this.signaling.leave();
    this.signaling = null;
  }

  private setState(state: P2PState): void {
    this.progress.state = state;
    void this.emitProgress();
  }

  private async emitProgress(): Promise<void> {
    if (!this.progressHook) return;
    await this.progressHook({ ...this.progress });
  }

  private finish(): void {
    if (this.settled) return;
    this.settled = true;
    this.setState('done');
    this.closeConnection();
    this.closeSignaling();
    this.resolveStart();
  }

  private fail(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.failure = error;
    this.progress.state = 'error';
    void this.emitProgress();
    // Unblock run(), wherever it is parked.
    const s = this.session;
    if (s) {
      s.error = error;
      this.wake(s);
    }
    const waiter = this.peerWaiter;
    this.peerWaiter = null;
    waiter?.();
    this.closeConnection();
    this.closeSignaling();
    this.rejectStart(error);
  }
}
