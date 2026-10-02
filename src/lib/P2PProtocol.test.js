const { P2PProtocol, Crypto } = require('../../dist/index.cjs');

describe('P2PProtocol', () => {
  let key, wrongKey;
  beforeAll(async () => {
    key = await Crypto.generateKey(Crypto.generateSeed(), 'gcm');
    wrongKey = await Crypto.generateKey(Crypto.generateSeed(), 'gcm');
  });

  describe('chunk math', () => {
    test('payload size caps at 256KiB minus gcm header minus index', () => {
      const expected = 262144 - Crypto.AES_GCM_HEADER_BYTES - 4;
      expect(P2PProtocol.chunkPayloadSize(null)).toBe(expected);
      expect(P2PProtocol.chunkPayloadSize(1024 * 1024)).toBe(expected);
    });
    test('payload size respects a smaller negotiated sctp max', () => {
      expect(P2PProtocol.chunkPayloadSize(65536)).toBe(
        65536 - Crypto.AES_GCM_HEADER_BYTES - 4,
      );
    });
    test('chunkCount', () => {
      expect(P2PProtocol.chunkCount(0, 1000)).toBe(0);
      expect(P2PProtocol.chunkCount(1, 1000)).toBe(1);
      expect(P2PProtocol.chunkCount(2001, 1000)).toBe(3);
    });
  });

  describe('control messages', () => {
    test('roundtrip', async () => {
      const msg = {
        t: 'meta',
        name: 'a.bin',
        size: 42,
        chunkPayloadSize: 1000,
      };
      const enc = await P2PProtocol.encryptControl(msg, key);
      expect(typeof enc).toBe('string');
      expect(enc).not.toContain('a.bin');
      await expect(P2PProtocol.decryptControl(enc, key)).resolves.toEqual(msg);
    });
    test('wrong key rejects', async () => {
      const enc = await P2PProtocol.encryptControl({ t: 'complete' }, key);
      await expect(P2PProtocol.decryptControl(enc, wrongKey)).rejects.toThrow();
    });
    test('garbage rejects', async () => {
      await expect(
        P2PProtocol.decryptControl('bm90IHJlYWw=', key),
      ).rejects.toThrow();
    });
  });

  describe('chunks', () => {
    test('roundtrip preserves index and payload', async () => {
      const payload = new Uint8Array([1, 2, 3, 4, 5]).buffer;
      const enc = await P2PProtocol.encryptChunk(7, payload, key);
      const dec = await P2PProtocol.decryptChunk(enc, key);
      expect(dec.index).toBe(7);
      expect(new Uint8Array(dec.payload)).toEqual(
        new Uint8Array([1, 2, 3, 4, 5]),
      );
    });
    test('large index roundtrips (4-byte big-endian)', async () => {
      const enc = await P2PProtocol.encryptChunk(
        0xfffffffe,
        new Uint8Array([9]).buffer,
        key,
      );
      const dec = await P2PProtocol.decryptChunk(enc, key);
      expect(dec.index).toBe(0xfffffffe);
    });
    test('tampered ciphertext rejects', async () => {
      const enc = new Uint8Array(
        await P2PProtocol.encryptChunk(1, new Uint8Array(100).buffer, key),
      );
      enc[enc.length - 1] ^= 0xff;
      await expect(P2PProtocol.decryptChunk(enc.buffer, key)).rejects.toThrow();
    });
    test('full-size chunk stays under the message cap', async () => {
      const size = P2PProtocol.chunkPayloadSize(null);
      const enc = await P2PProtocol.encryptChunk(
        0,
        new Uint8Array(size).buffer,
        key,
      );
      expect(enc.byteLength).toBeLessThanOrEqual(P2PProtocol.MAX_MESSAGE_SIZE);
    });
  });
});
