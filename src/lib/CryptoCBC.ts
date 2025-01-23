/**
 * The default encryption/decryption class for !3.
 *
 * The encrypted data will be structured as follows:
 *
 * `{ [IV (16 bytes)] ( Encrypted Data: [Checksum (32 bytes)] [Data] [Padding (up to 16 bytes)] ) }`
 * @category Lib
 */
export class CryptoCBC {
  /* @hidden */
  private constructor() {}

  /**
   * The seed length in bytes, used for generating keys
   */
  static readonly AES_SEED_LENGTH = 32;

  /**
   * The length of the AES-CBC IV in bytes
   */
  static readonly AES_CBC_IV_LENGTH = 16;

  /**
   * The length of the AES-CBC padding in bytes
   */
  static readonly AES_CBC_PADDING_LENGTH = 16;

  /**
   * The length of the SHA-256 checksum in bytes
   */
  static readonly SHA256_CHECKSUM_LENGTH = 32;

  /**
   * The total length in bytes each encrypted chunk will grow by (at most)
   * @default AES_CBC_IV_LENGTH + SHA256_CHECKSUM_LENGTH + AES_CBC_PADDING_LENGTH
   */
  static readonly AES_HEADER_BYTES = this.AES_CBC_IV_LENGTH + this.SHA256_CHECKSUM_LENGTH + this.AES_CBC_PADDING_LENGTH;

  /**
   * Convert a buffer to base64
   * @param buffer The buffer to convert
   * @returns The base64 string
   */
  static buf2base(buffer: Uint8Array<ArrayBuffer>): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  }

  /**
   * Convert a base64 string to a buffer
   * @param base The base64 string to convert
   * @returns The buffer
   */
  static base2buf(base: string): ArrayBuffer {
    return Uint8Array.from(atob(base), c => c.charCodeAt(0)).buffer;
  }

  /**
   * Generate a random seed for encryption
   * @returns The seed according to the {@link AES_SEED_LENGTH}
   */
  static generateSeed(): string {
    return this.buf2base(crypto.getRandomValues(new Uint8Array(this.AES_SEED_LENGTH)));
  }

  /**
   * Generate a key from a seed
   * @param seed The seed to generate the key from
   * @returns The generated key
   * @see {@link generateSeed}
   */
  static async generateKey(seed: string): Promise<CryptoKey> {
    const buf = this.base2buf(seed);
    if (buf.byteLength !== this.AES_SEED_LENGTH) throw new Error('Invalid seed length');
    return crypto.subtle.importKey('raw', buf, 'AES-CBC', true, ['encrypt', 'decrypt']);
  }

  private static async sha256(data: ArrayBuffer): Promise<ArrayBuffer> {
    return crypto.subtle.digest('SHA-256', data);
  }

  private static async encryptArrayBuffer(data: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
    const checksum = await this.sha256(data);
    const combinedData = new Uint8Array(data.byteLength + checksum.byteLength);
    combinedData.set(new Uint8Array(checksum), 0);
    combinedData.set(new Uint8Array(data), checksum.byteLength);

    const iv = crypto.getRandomValues(new Uint8Array(this.AES_CBC_IV_LENGTH));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, combinedData.buffer);

    const result = new Uint8Array(this.AES_CBC_IV_LENGTH + encrypted.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(encrypted), this.AES_CBC_IV_LENGTH);
    return result.buffer;
  }

  private static async encryptString(data: string, key: CryptoKey): Promise<string> {
    const encrypted = await this.encryptArrayBuffer((new Uint8Array([...data].map(c => c.charCodeAt(0)))).buffer, key);
    return this.buf2base(new Uint8Array(encrypted));
  }

  /**
   * Encrypt data with a key
   * @param data The data to encrypt
   * @param key The key to encrypt the data with
   * @returns The encrypted data
   * @see {@link generateKey}
   */
  static async encrypt<T = string|ArrayBuffer>(data: T, key: CryptoKey): Promise<T> {
    if (typeof data === 'string') return this.encryptString(data, key) as T;
    else return this.encryptArrayBuffer(data as ArrayBuffer, key) as T;
  }

  private static async decryptArrayBuffer(data: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
    const iv = new Uint8Array(data, 0, this.AES_CBC_IV_LENGTH);
    const encrypted = new Uint8Array(data, this.AES_CBC_IV_LENGTH);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, encrypted);

    const checksum = new Uint8Array(decrypted, 0, this.SHA256_CHECKSUM_LENGTH);
    const originalData = new Uint8Array(decrypted, this.SHA256_CHECKSUM_LENGTH);

    const computedChecksum = new Uint8Array(await this.sha256(originalData.buffer));

    if (!checksum.every((byte, i) => byte === computedChecksum[i])) {
      throw new Error('Checksum mismatch: data integrity check failed');
    }

    return originalData.buffer;
  }

  private static async decryptString(data: string, key: CryptoKey): Promise<string> {
    const decrypted = await this.decryptArrayBuffer(this.base2buf(data), key);
    return String.fromCharCode(...new Uint8Array(decrypted));
  }

  /**
   * Decrypt data with a key
   * @param data The data to decrypt
   * @param key The key to decrypt the data with
   * @returns The decrypted data
   * @see {@link generateKey}
   */
  static async decrypt<T = string|ArrayBuffer>(data: T, key: CryptoKey): Promise<T> {
    if (typeof data === 'string') return this.decryptString(data, key) as T;
    else return this.decryptArrayBuffer(data as ArrayBuffer, key) as T;
  }
}
