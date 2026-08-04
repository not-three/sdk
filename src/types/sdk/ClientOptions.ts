import { RTCFactory } from './P2P';

export interface ClientOptions {
  /**
   * The base URL of the API with a trailing slash.
   * @example 'https://api.example.com/'
   */
  baseUrl: string;

  /**
   * The instance password of the api. Only required if the API runs in private mode.
   * @example 'password'
   * @default undefined
   */
  password?: string;

  /**
   * A factory creating `RTCPeerConnection` instances, used by the P2P transfer
   * classes. Defaults to the global `RTCPeerConnection`; supply your own in
   * runtimes without one (for example `node-datachannel` in Node).
   * @default (config) => new globalThis.RTCPeerConnection(config)
   */
  rtc?: RTCFactory;

  /**
   * The `WebSocket` constructor used to reach the signaling gateway.
   * Defaults to the global `WebSocket` (native in browsers and Node >= 22).
   * @default globalThis.WebSocket
   */
  webSocket?: typeof WebSocket;
}
