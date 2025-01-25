const { Crypto } = require('../../dist/index.cjs');

describe('Crypto', () => {
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
    });
  });
});
