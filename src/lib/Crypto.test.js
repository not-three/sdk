const { Crypto } = require('../../dist/index.cjs');

describe('Crypto', () => {
  describe('encoding helpers', () => {
    test('buf2base / base2buf round-trip', () => {
      const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
      const b64 = Crypto.buf2base(bytes);
      expect(typeof b64).toBe('string');
      const back = new Uint8Array(Crypto.base2buf(b64));
      expect(Array.from(back)).toEqual(Array.from(bytes));
    });

    test('generateSeed returns a 32-byte base64 seed', () => {
      const seed = Crypto.generateSeed();
      expect(new Uint8Array(Crypto.base2buf(seed)).byteLength).toBe(Crypto.AES_SEED_LENGTH);
      expect(Crypto.AES_SEED_LENGTH).toBe(32);
    });

    test('generateSeed is random (two seeds differ)', () => {
      expect(Crypto.generateSeed()).not.toBe(Crypto.generateSeed());
    });
  });

  describe('generateKey', () => {
    test('rejects a seed of the wrong length', async () => {
      const shortSeed = Crypto.buf2base(new Uint8Array(8));
      await expect(Crypto.generateKey(shortSeed)).rejects.toThrow('Invalid seed length');
    });

    test('accepts a valid seed for both modes', async () => {
      const seed = Crypto.generateSeed();
      await expect(Crypto.generateKey(seed, 'cbc')).resolves.toBeDefined();
      await expect(Crypto.generateKey(seed, 'gcm')).resolves.toBeDefined();
    });
  });

  ['cbc', 'gcm'].forEach(mode => {
    describe(`Crypto${mode.toUpperCase()}`, () => {
      test(`encrypt/decrypt string`, async () => {
        const seed = Crypto.generateSeed();
        const key = await Crypto.generateKey(seed, mode);
        const enc = await Crypto.encrypt('Hello, World!', key, mode);
        const dec = await Crypto.decrypt(enc, key, mode);
        expect(dec).toBe('Hello, World!');
      });

      test(`encrypt/decrypt buffer`, async () => {
        const buffer = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]).buffer;
        const seed = Crypto.generateSeed();
        const key = await Crypto.generateKey(seed, mode);
        const enc = await Crypto.encrypt(buffer, key, mode);
        const dec = await Crypto.decrypt(enc, key, mode);
        expect(dec.byteLength).toBe(buffer.byteLength);
        for (let i = 0; i < buffer.byteLength; i++) {
          expect(dec[i]).toBe(buffer[i]);
        }
      });

      test(`encrypt/decrypt unicode string`, async () => {
        const msg = 'Héllo 世界 🌍 café — ñ';
        const seed = Crypto.generateSeed();
        const key = await Crypto.generateKey(seed, mode);
        const enc = await Crypto.encrypt(msg, key, mode);
        const dec = await Crypto.decrypt(enc, key, mode);
        expect(dec).toBe(msg);
      });

      test(`encrypt/decrypt large string`, async () => {
        const msg = 'a'.repeat(300000);
        const seed = Crypto.generateSeed();
        const key = await Crypto.generateKey(seed, mode);
        const enc = await Crypto.encrypt(msg, key, mode);
        const dec = await Crypto.decrypt(enc, key, mode);
        expect(dec).toBe(msg);
      });

      test(`decrypts legacy (pre-UTF-8) Latin-1 payloads`, async () => {
        // Reproduce how older SDK versions serialized strings: one byte per
        // UTF-16 code unit. Latin-1 characters (128-255) round-tripped before
        // the UTF-8 switch, so they must still decode after it.
        const msg = 'café é ñ';
        const seed = Crypto.generateSeed();
        const key = await Crypto.generateKey(seed, mode);
        const legacyBytes = new Uint8Array([...msg].map(c => c.charCodeAt(0)));
        const encBuffer = await Crypto.encrypt(legacyBytes.buffer, key, mode);
        const encString = Crypto.buf2base(new Uint8Array(encBuffer));
        const dec = await Crypto.decrypt(encString, key, mode);
        expect(dec).toBe(msg);
      });

      test(`decrypt with the wrong key fails`, async () => {
        const key = await Crypto.generateKey(Crypto.generateSeed(), mode);
        const wrongKey = await Crypto.generateKey(Crypto.generateSeed(), mode);
        const enc = await Crypto.encrypt('secret', key, mode);
        await expect(Crypto.decrypt(enc, wrongKey, mode)).rejects.toThrow();
      });

      test(`tampering with the ciphertext is detected`, async () => {
        const seed = Crypto.generateSeed();
        const key = await Crypto.generateKey(seed, mode);
        const enc = new Uint8Array(await Crypto.encrypt(
          new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer, key, mode,
        ));
        // Flip a byte in the encrypted body (past the IV).
        enc[enc.length - 1] ^= 0xff;
        await expect(Crypto.decrypt(enc.buffer, key, mode)).rejects.toThrow();
      });
    });
  });
});
