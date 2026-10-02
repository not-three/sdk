import { SubClient } from '../lib/SubClient';
import { SystemAPI } from './System';
import { RTCFactory } from '../types/sdk/P2P';
import { InfoResponse } from '../types/api/InfoResponse';
import { P2PRoom, P2PRoomOptions } from '../lib/P2PRoom';

/**
 * Sub-client for live P2P transfers. Provides the gateway address,
 * feature detection, and the injectable runtime primitives.
 * @category Client
 * @see {@link Not3Client.p2p}
 */
export class P2PClient extends SubClient {
  /**
   * The WebSocket signaling gateway URL, derived from the API base URL.
   * @returns The `ws://` or `wss://` gateway URL.
   */
  gatewayUrl(): string {
    const url = new URL('p2p', this.options.baseUrl);
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
    return url.toString();
  }

  /**
   * Whether the connected API has P2P transfers enabled.
   * @throws AxiosError If the request fails.
   * @returns True if the feature is available.
   */
  async isEnabled(): Promise<boolean> {
    const info = await new SystemAPI(this.api, this.options).info();
    // p2pEnabled lands in the generated InfoResponse once the API ships it;
    // read tolerantly so this SDK works against both old and new servers.
    return (
      (info as InfoResponse & { p2pEnabled?: boolean }).p2pEnabled === true
    );
  }

  /**
   * Whether the connected API has P2P room signaling enabled.
   * @throws AxiosError If the request fails.
   * @returns True if rooms can be created and joined.
   */
  async roomsEnabled(): Promise<boolean> {
    const info = await new SystemAPI(this.api, this.options).info();
    // p2pRooms lands in the generated InfoResponse once the API ships it;
    // read tolerantly so this SDK works against both old and new servers.
    return (info as InfoResponse & { p2pRooms?: boolean }).p2pRooms === true;
  }

  /**
   * Create a handle for an encrypted P2P room.
   * @param opts The room options, including the shared seed.
   * @returns The room, not yet created or joined.
   * @see {@link P2PRoom.create}
   * @see {@link P2PRoom.join}
   */
  room(opts: P2PRoomOptions): P2PRoom {
    return new P2PRoom(this, opts);
  }

  /**
   * The WebSocket constructor to use (injected or global).
   * @throws Error If no implementation is available.
   * @returns The constructor.
   */
  webSocketCtor(): typeof WebSocket {
    const ctor = this.options.webSocket ?? globalThis.WebSocket;
    if (!ctor)
      throw new Error(
        'No WebSocket implementation available: pass ClientOptions.webSocket',
      );
    return ctor;
  }

  /**
   * The RTCPeerConnection factory to use (injected or global).
   * @throws Error If no implementation is available.
   * @returns The factory.
   */
  rtcFactory(): RTCFactory {
    if (this.options.rtc) return this.options.rtc;
    if (!globalThis.RTCPeerConnection)
      throw new Error(
        'No RTCPeerConnection implementation available: pass ClientOptions.rtc',
      );
    return (config) => new globalThis.RTCPeerConnection(config);
  }
}
