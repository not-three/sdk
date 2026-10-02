import { P2PClient } from '../clients/P2P';
import { Crypto } from './Crypto';
import { connectPeer, P2PConnectResult } from './P2PConnection';
import { P2PProtocol } from './P2PProtocol';
import { P2PSignaling } from './P2PSignaling';

/** The lifecycle of one room membership. */
export type P2PRoomState = 'idle' | 'connecting' | 'joined' | 'closed';

/** A known room member; `connected` means its data channel is open. */
export interface P2PRoomPeer { id: string; connected: boolean }

/** Configuration for an encrypted room. */
export interface P2PRoomOptions {
  /** The shared seed, kept in the link fragment and never sent to the gateway. */
  seed: string;
  /** Called once if signaling is lost while at least one peer channel remains open. */
  onSignalingLost?: () => void;
}

interface PeerLink {
  id: string;
  connection: P2PConnectResult | null;
  starting: boolean;
  signal: {
    onSignal: ((payload: unknown) => void) | null;
    sendSignal: (payload: unknown) => void;
  };
  queue: Promise<void>;
}

/**
 * An encrypted WebRTC mesh room. The gateway handles membership and directed
 * signaling; application framing and document state belong to the caller.
 * @category Lib
 */
export class P2PRoom {
  /** Called for a decrypted string or binary message. */
  onMessage: ((peerId: string, data: ArrayBuffer | string) => void) | null = null;
  /** Called when a peer's data channel opens. */
  onPeerJoined: ((peerId: string) => void) | null = null;
  /** Called when a peer's data channel closes or fails authentication. */
  onPeerLeft: ((peerId: string) => void) | null = null;
  /** Called on each room state change. */
  onStateChange: ((state: P2PRoomState) => void) | null = null;
  /**
   * Called once when the room closes. A signaling loss with live peer channels
   * instead calls `opts.onSignalingLost`; those channels keep working until
   * `leave()` or the last peer disconnects.
   */
  onClose: ((err?: Error) => void) | null = null;

  private currentState: P2PRoomState = 'idle';
  private selfId: string | null = null;
  private signaling: P2PSignaling | null = null;
  private key: CryptoKey | null = null;
  private iceServers: RTCIceServer[] = [];
  private readonly links = new Map<string, PeerLink>();
  private signalingLost = false;
  private closeNotified = false;

  /** Create a room handle with a configured P2P client and shared seed. */
  constructor(private readonly client: P2PClient, private readonly opts: P2PRoomOptions) {}

  /** Current room lifecycle state. */
  get state(): P2PRoomState { return this.currentState; }
  /** This member's gateway id after a successful create or join. */
  get peerId(): string | null { return this.selfId; }

  /** Create a new room and resolve on the gateway grant. */
  async create(): Promise<{ roomId: string; peerId: string }> {
    const signaling = await this.open();
    try {
      const grant = await signaling.create('room');
      if (!grant.peerId) throw new Error('Room grant has no peerId');
      this.selfId = grant.peerId;
      this.iceServers = grant.iceServers;
      this.setState('joined');
      return { roomId: grant.sessionId, peerId: grant.peerId };
    } catch (e) {
      this.close(e as Error);
      throw e;
    }
  }

  /** Join an existing room; data channels may open after this resolves. */
  async join(roomId: string): Promise<{ peerId: string; peers: string[] }> {
    const signaling = await this.open();
    try {
      const grant = await signaling.join(roomId);
      if (!grant.peerId || grant.kind !== 'room') throw new Error('Invalid room grant');
      this.selfId = grant.peerId;
      this.iceServers = grant.iceServers;
      const peers = grant.peers ?? [];
      for (const id of peers) this.ensurePeer(id);
      this.setState('joined');
      // A join grant is useful immediately, before any WebRTC handshake ends.
      setTimeout(() => {
        if (this.state !== 'joined' || this.signalingLost) return;
        for (const id of peers) this.startPeer(id, 'sender');
      }, 0);
      return { peerId: grant.peerId, peers };
    } catch (e) {
      this.close(e as Error);
      throw e;
    }
  }

  /** Known other members, including peers whose channel is still opening. */
  peers(): P2PRoomPeer[] {
    return [...this.links.values()].map(({ id, connection }) => ({ id, connected: connection?.channel.readyState === 'open' }));
  }

  /** Send one encrypted message to every currently connected peer. */
  async broadcast(data: ArrayBuffer | Uint8Array | string): Promise<void> {
    await Promise.all(this.peers().filter((peer) => peer.connected).map((peer) => this.send(peer.id, data)));
  }

  /** Send one encrypted message to a connected peer. */
  async send(peerId: string, data: ArrayBuffer | Uint8Array | string): Promise<void> {
    const channel = this.links.get(peerId)?.connection?.channel;
    if (!channel || channel.readyState !== 'open' || !this.key) throw new Error('Peer is not connected');
    let frame: ArrayBuffer | string;
    if (typeof data === 'string') {
      frame = await Crypto.encrypt(data, this.key, 'gcm');
      if (frame.length > P2PProtocol.MAX_MESSAGE_SIZE) throw new Error('P2P message exceeds maximum size');
    } else {
      const plain = data instanceof Uint8Array
        ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
        : data;
      if (plain.byteLength + Crypto.AES_GCM_HEADER_BYTES > P2PProtocol.MAX_MESSAGE_SIZE)
        throw new Error('P2P message exceeds maximum size');
      frame = await Crypto.encrypt(plain, this.key, 'gcm');
    }
    if (channel.readyState !== 'open') throw new Error('Peer is not connected');
    if (typeof frame === 'string') channel.send(frame);
    else channel.send(frame);
  }

  /** Leave the room and close all peer channels. Calls `onClose` once. */
  leave(): void { this.close(); }

  private async open(): Promise<P2PSignaling> {
    if (this.currentState !== 'idle') throw new Error('Room already started');
    this.setState('connecting');
    try {
      this.key = await Crypto.generateKey(this.opts.seed, 'gcm');
      const signaling = new P2PSignaling(this.client.gatewayUrl(), this.client.webSocketCtor());
      this.signaling = signaling;
      signaling.onClose = (error) => this.onSignalingClosed(error);
      signaling.onSignal = (payload, from) => this.onSignal(from, payload);
      signaling.onPeerJoined = (id) => { if (id && this.currentState === 'joined') this.ensurePeer(id); };
      // A gateway departure can leave an established RTC channel alive.
      signaling.onPeerLeft = (id) => {
        if (id && !this.links.get(id)?.connection) this.dropPeer(id);
      };
      await signaling.connect();
      return signaling;
    } catch (e) {
      this.close(e as Error);
      throw e;
    }
  }

  private ensurePeer(id: string): PeerLink {
    let link = this.links.get(id);
    if (link) return link;
    const signal = {
      onSignal: null as ((payload: unknown) => void) | null,
      sendSignal: (payload: unknown) => this.signaling?.sendSignal(payload, id),
    };
    link = { id, connection: null, starting: false, signal, queue: Promise.resolve() };
    this.links.set(id, link);
    return link;
  }

  private onSignal(from: string | undefined, payload: unknown): void {
    if (!from || this.currentState !== 'joined' || this.signalingLost) return;
    const link = this.ensurePeer(from);
    if (!link.starting && !link.connection) this.startPeer(from, 'receiver');
    link.signal.onSignal?.(payload);
  }

  private startPeer(id: string, role: 'sender' | 'receiver'): void {
    const link = this.ensurePeer(id);
    if (link.starting || link.connection || !this.signaling) return;
    link.starting = true;
    let pending: Promise<P2PConnectResult>;
    try {
      pending = connectPeer({ role, signaling: link.signal, rtc: this.client.rtcFactory(), iceServers: this.iceServers });
    } catch {
      this.dropPeer(id);
      return;
    }
    void pending.then((connection) => {
      if (this.links.get(id) !== link || this.currentState !== 'joined') {
        connection.pc.close();
        return;
      }
      link.connection = connection;
      connection.channel.onmessage = (event: MessageEvent) => {
        link.queue = link.queue.then(() => this.receive(link, event.data)).catch(() => this.dropPeer(id));
      };
      connection.channel.onclose = () => this.dropPeer(id);
      connection.pc.onconnectionstatechange = () => {
        if (connection.pc.connectionState === 'failed' || connection.pc.connectionState === 'closed') this.dropPeer(id);
      };
      this.onPeerJoined?.(id);
    }, () => this.dropPeer(id));
  }

  private async receive(link: PeerLink, data: unknown): Promise<void> {
    if (this.links.get(link.id) !== link || !this.key) return;
    let plain: ArrayBuffer | string;
    if (typeof data === 'string') {
      if (data.length > P2PProtocol.MAX_MESSAGE_SIZE) throw new Error('P2P message exceeds maximum size');
      plain = await Crypto.decrypt(data, this.key, 'gcm');
    } else {
      const frame = data instanceof ArrayBuffer ? data : ArrayBuffer.isView(data)
        ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer : null;
      if (!frame || frame.byteLength > P2PProtocol.MAX_MESSAGE_SIZE) throw new Error('Invalid P2P message');
      plain = await Crypto.decrypt(frame, this.key, 'gcm');
    }
    try {
      this.onMessage?.(link.id, plain);
    } catch {
      // Application message handling must not tear down a healthy channel.
    }
  }

  private dropPeer(id: string): void {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    const wasConnected = !!link.connection;
    link.signal.onSignal = null;
    if (link.connection) {
      link.connection.channel.onclose = null;
      link.connection.channel.onmessage = null;
      link.connection.pc.onconnectionstatechange = null;
      link.connection.pc.close();
    }
    if (wasConnected) this.onPeerLeft?.(id);
    if (this.signalingLost && this.peers().every((peer) => !peer.connected)) this.close();
  }

  private onSignalingClosed(error?: Error): void {
    if (this.currentState === 'closed') return;
    this.signaling?.close();
    this.signaling = null;
    if (this.currentState === 'joined' && this.peers().some((peer) => peer.connected)) {
      if (!this.signalingLost) {
        this.signalingLost = true;
        this.opts.onSignalingLost?.();
      }
      return;
    }
    this.close(error);
  }

  private setState(state: P2PRoomState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.onStateChange?.(state);
  }

  private close(error?: Error): void {
    if (this.currentState === 'closed') return;
    this.setState('closed');
    const signaling = this.signaling;
    this.signaling = null;
    if (signaling) {
      signaling.onClose = null;
      signaling.leave();
    }
    for (const id of [...this.links.keys()]) this.dropPeer(id);
    if (!this.closeNotified) {
      this.closeNotified = true;
      this.onClose?.(error);
    }
  }
}
