import { Crypto } from './Crypto';
import { P2PControlMessage } from '../types/sdk/P2P';

/**
 * Framing, chunk math, and encryption helpers for the P2P wire protocol.
 * String frames carry {@link P2PControlMessage}s, binary frames carry chunks
 * whose plaintext is `[4-byte big-endian chunk index][payload]`.
 * @category Lib
 */
export class P2PProtocol {
  /* @hidden */
  private constructor() {}

  /**
   * Hard cap for a single data-channel message (cross-implementation safe).
   * @default 262144
   */
  static readonly MAX_MESSAGE_SIZE = 262144;

  /**
   * Bytes used for the chunk index prefix inside the plaintext.
   * @default 4
   */
  static readonly CHUNK_INDEX_BYTES = 4;

  /**
   * Pause sending above this many buffered bytes.
   * @default 4 * 1024 * 1024
   */
  static readonly BUFFER_HIGH_WATER = 4 * 1024 * 1024;

  /**
   * Resume sending below this many buffered bytes.
   * @default 1 * 1024 * 1024
   */
  static readonly BUFFER_LOW_WATER = 1 * 1024 * 1024;

  /**
   * How often a single chunk may be re-requested before aborting.
   * @default 3
   */
  static readonly NACK_RETRY_LIMIT = 3;

  /**
   * Timeout for establishing the peer connection after pairing.
   * @default 30000
   */
  static readonly CONNECT_TIMEOUT_MS = 30000;

  /**
   * Timeout for awaited control messages (meta/accept/complete).
   * @default 30000
   */
  static readonly CONTROL_TIMEOUT_MS = 30000;

  /**
   * Usable payload bytes per chunk for a given negotiated SCTP max message size.
   * @param sctpMaxMessageSize The negotiated maximum, or null when unknown.
   * @returns The plaintext payload size of a single chunk.
   */
  static chunkPayloadSize(sctpMaxMessageSize?: number | null): number {
    const cap = Math.min(
      sctpMaxMessageSize || this.MAX_MESSAGE_SIZE,
      this.MAX_MESSAGE_SIZE,
    );
    return cap - Crypto.AES_GCM_HEADER_BYTES - this.CHUNK_INDEX_BYTES;
  }

  /**
   * Total chunks for a file size.
   * @param size The file size in bytes.
   * @param chunkPayloadSize The payload size of a single chunk.
   * @returns The number of chunks.
   */
  static chunkCount(size: number, chunkPayloadSize: number): number {
    return Math.ceil(size / chunkPayloadSize);
  }

  /**
   * Encrypt a control message into a string frame.
   * @param msg The message to encrypt.
   * @param key The transfer key.
   * @returns The encrypted string frame.
   */
  static async encryptControl(
    msg: P2PControlMessage,
    key: CryptoKey,
  ): Promise<string> {
    return Crypto.encrypt(JSON.stringify(msg), key, 'gcm');
  }

  /**
   * Decrypt a string frame into a control message.
   * @param data The frame to decrypt.
   * @param key The transfer key.
   * @throws Error If the key is wrong or the frame is garbage.
   * @returns The control message.
   */
  static async decryptControl(
    data: string,
    key: CryptoKey,
  ): Promise<P2PControlMessage> {
    return JSON.parse(
      await Crypto.decrypt(data, key, 'gcm'),
    ) as P2PControlMessage;
  }

  /**
   * Encrypt a chunk into a binary frame.
   * @param index The absolute chunk index.
   * @param payload The plaintext chunk payload.
   * @param key The transfer key.
   * @returns The encrypted binary frame.
   */
  static async encryptChunk(
    index: number,
    payload: ArrayBuffer,
    key: CryptoKey,
  ): Promise<ArrayBuffer> {
    const plain = new Uint8Array(this.CHUNK_INDEX_BYTES + payload.byteLength);
    new DataView(plain.buffer).setUint32(0, index, false);
    plain.set(new Uint8Array(payload), this.CHUNK_INDEX_BYTES);
    return Crypto.encrypt(plain.buffer as ArrayBuffer, key, 'gcm');
  }

  /**
   * Decrypt a binary frame into index and payload.
   * @param data The frame to decrypt.
   * @param key The transfer key.
   * @throws Error If the frame was tampered with or the key is wrong.
   * @returns The chunk index and its payload.
   */
  static async decryptChunk(
    data: ArrayBuffer,
    key: CryptoKey,
  ): Promise<{ index: number; payload: ArrayBuffer }> {
    const plain = await Crypto.decrypt(data, key, 'gcm');
    const view = new DataView(plain);
    return {
      index: view.getUint32(0, false),
      payload: plain.slice(this.CHUNK_INDEX_BYTES),
    };
  }
}
