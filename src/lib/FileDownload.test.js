const { FileDownload, FileUpload, Crypto } = require('../../dist/index.cjs');

function fakeFilesApi(file) {
  return { getFile: jest.fn(async () => file) };
}

/** Build a fetch stub whose response body streams `bytes` across `reads` chunks. */
function stubFetch(bytes, reads = 1) {
  const size = Math.ceil(bytes.length / reads);
  const slices = [];
  for (let i = 0; i < bytes.length; i += size) slices.push(bytes.slice(i, i + size));
  if (slices.length === 0) slices.push(new Uint8Array());
  global.fetch = jest.fn(async () => ({
    body: {
      getReader() {
        let i = 0;
        return {
          read: async () =>
            i < slices.length
              ? { done: false, value: slices[i++] }
              : { done: true, value: undefined },
        };
      },
    },
  }));
}

describe('FileDownload', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

  describe('guards before prepare', () => {
    test('getFileMetadata throws', () => {
      const dl = new FileDownload(fakeFilesApi(), 'f1', Crypto.generateSeed());
      expect(() => dl.getFileMetadata()).toThrow('Download not prepared');
    });
    test('getTotalChunks throws', () => {
      const dl = new FileDownload(fakeFilesApi(), 'f1', Crypto.generateSeed());
      expect(() => dl.getTotalChunks()).toThrow('Download not prepared');
    });
  });

  describe('prepare / metadata', () => {
    test('prepare fetches metadata and exposes it', async () => {
      const file = { size: 123, url: 'https://cdn/f1' };
      const api = fakeFilesApi(file);
      const dl = new FileDownload(api, 'f1', Crypto.generateSeed());
      await dl.prepare();
      expect(api.getFile).toHaveBeenCalledWith('f1');
      expect(dl.getFileMetadata()).toEqual(file);
    });

    test('getTotalChunks divides the encrypted size by CHUNK_SIZE', async () => {
      const api = fakeFilesApi({ size: FileUpload.CHUNK_SIZE * 2 + 1, url: 'x' });
      const dl = new FileDownload(api, 'f1', Crypto.generateSeed());
      await dl.prepare();
      expect(dl.getTotalChunks()).toBe(3);
    });
  });

  describe('start (decrypts a streamed file)', () => {
    async function encryptPayload(seed, payload) {
      const key = await Crypto.generateKey(seed); // cbc, matches FileDownload
      const enc = await Crypto.encrypt(payload.buffer, key);
      return new Uint8Array(enc);
    }

    test('decrypts a single sub-chunk file', async () => {
      const seed = Crypto.generateSeed();
      const payload = new Uint8Array([10, 20, 30, 40, 50]);
      const encBytes = await encryptPayload(seed, payload);
      stubFetch(encBytes, 1);

      const api = fakeFilesApi({ size: payload.length, url: 'https://cdn/f1' });
      const dl = new FileDownload(api, 'f1', seed);
      await dl.prepare();

      const received = [];
      await dl.start(async (buf, index) => received.push({ data: new Uint8Array(buf), index }));

      expect(received).toHaveLength(1);
      expect(received[0].index).toBe(0);
      expect(Array.from(received[0].data)).toEqual(Array.from(payload));
    });

    test('accumulates across multiple stream reads before decrypting', async () => {
      const seed = Crypto.generateSeed();
      const payload = new Uint8Array(Array.from({ length: 64 }, (_, i) => i));
      const encBytes = await encryptPayload(seed, payload);
      stubFetch(encBytes, 4); // deliver the ciphertext in 4 pieces

      const api = fakeFilesApi({ size: payload.length, url: 'https://cdn/f1' });
      const dl = new FileDownload(api, 'f1', seed);
      await dl.prepare();

      const received = [];
      await dl.start(async (buf, index) => received.push({ data: new Uint8Array(buf), index }));

      expect(received).toHaveLength(1);
      expect(Array.from(received[0].data)).toEqual(Array.from(payload));
    });

    test('start before prepare throws', async () => {
      const dl = new FileDownload(fakeFilesApi(), 'f1', Crypto.generateSeed());
      await expect(dl.start(async () => {})).rejects.toThrow('Download not prepared');
    });
  });
});
