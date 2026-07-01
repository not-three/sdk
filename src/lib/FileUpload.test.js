const { FileUpload, Crypto } = require('../../dist/index.cjs');

/** A fake FilesAPI that records the upload flow and hands back synthetic etags. */
function fakeFilesApi(overrides = {}) {
  return {
    startUpload: jest.fn(async () => 'upload-1'),
    getUploadChunkURL: jest.fn(async (id, length, part) => `https://s3/${part}`),
    uploadChunk: jest.fn(async (url) => `etag-${url}`),
    completeUpload: jest.fn(async () => {}),
    delete: jest.fn(async () => {}),
    ...overrides,
  };
}

/** getBytes that returns deterministic buffers of the requested length. */
const getBytes = async (start, end) => new Uint8Array(end - start).fill(7).buffer;

describe('FileUpload', () => {
  const SEED = Crypto.generateSeed();

  describe('chunk math', () => {
    test('getChunkCount divides by the crypto-adjusted chunk size', () => {
      const up = new FileUpload(fakeFilesApi(), 'f', 0, 1, true, SEED);
      expect(up.getChunkCount()).toBe(0);
      const one = new FileUpload(fakeFilesApi(), 'f', 100, 1, true, SEED);
      expect(one.getChunkCount()).toBe(1);
      const three = new FileUpload(fakeFilesApi(), 'f', FileUpload.ACTUAL_CHUNK_SIZE * 2 + 1, 1, true, SEED);
      expect(three.getChunkCount()).toBe(3);
    });

    test('ACTUAL_CHUNK_SIZE is CHUNK_SIZE minus the AES-CBC header', () => {
      expect(FileUpload.ACTUAL_CHUNK_SIZE).toBe(FileUpload.CHUNK_SIZE - Crypto.AES_CBC_HEADER_BYTES);
    });

    test('getEncryptedSize is a multiple of CHUNK_SIZE', () => {
      const up = new FileUpload(fakeFilesApi(), 'f', 100, 1, true, SEED);
      expect(up.getEncryptedSize()).toBe(FileUpload.CHUNK_SIZE);
    });
  });

  describe('state guards before start', () => {
    test('getID throws', () => {
      expect(() => new FileUpload(fakeFilesApi(), 'f', 100).getID()).toThrow('Upload not started');
    });
    test('getProgress throws', () => {
      expect(() => new FileUpload(fakeFilesApi(), 'f', 100).getProgress()).toThrow('Upload not started');
    });
    test('cancel throws', async () => {
      await expect(new FileUpload(fakeFilesApi(), 'f', 100).cancel()).rejects.toThrow('Upload not started');
    });
    test('isStarted/isFinished are false', () => {
      const up = new FileUpload(fakeFilesApi(), 'f', 100);
      expect(up.isStarted()).toBe(false);
      expect(up.isFinished()).toBe(false);
    });
    test('getSeed returns the provided seed', () => {
      expect(new FileUpload(fakeFilesApi(), 'f', 100, 1, true, SEED).getSeed()).toBe(SEED);
    });
  });

  describe('start (single chunk, happy path)', () => {
    test('runs the full upload flow and finishes', async () => {
      const api = fakeFilesApi();
      const up = new FileUpload(api, 'file.bin', 1000, 1, true, SEED);
      await up.start(getBytes);

      expect(api.startUpload).toHaveBeenCalledWith('file.bin');
      // part number is 1-indexed; length is the encrypted byte length.
      expect(api.getUploadChunkURL).toHaveBeenCalledTimes(1);
      const [, encLength, part] = api.getUploadChunkURL.mock.calls[0];
      expect(part).toBe(1);
      expect(encLength).toBeGreaterThan(1000);
      expect(api.uploadChunk).toHaveBeenCalledTimes(1);
      expect(api.completeUpload).toHaveBeenCalledTimes(1);
      const [, etags] = api.completeUpload.mock.calls[0];
      expect(etags).toEqual(['etag-https://s3/1']);

      expect(up.isFinished()).toBe(true);
      expect(up.isStarted()).toBe(true);
      expect(up.getID()).toBe('upload-1');
      expect(up.getProgress()[0].state).toBe('done');
      expect(up.getProgress()[0].etag).toBe('etag-https://s3/1');
    });

    test('fires the progress hook', async () => {
      const up = new FileUpload(fakeFilesApi(), 'file.bin', 1000, 1, true, SEED);
      const states = [];
      up.onProgress(p => { if (p[0]) states.push(p[0].state); });
      await up.start(getBytes);
      expect(states).toEqual(expect.arrayContaining(['read', 'crypto', 'upload', 'done']));
    });

    test('starting twice throws', async () => {
      const up = new FileUpload(fakeFilesApi(), 'file.bin', 1000, 1, true, SEED);
      await up.start(getBytes);
      await expect(up.start(getBytes)).rejects.toThrow('Upload already started');
    });
  });

  describe('failure handling', () => {
    test('cancels the upload when a chunk read throws (cancelOnError)', async () => {
      const api = fakeFilesApi();
      const up = new FileUpload(api, 'file.bin', 1000, 1, true, SEED);
      const boom = async () => { throw new Error('read failed'); };
      await expect(up.start(boom)).rejects.toThrow('read failed');
      expect(api.delete).toHaveBeenCalledWith('upload-1');
      expect(up.isFinished()).toBe(false);
    });

    test('does not auto-cancel when cancelOnError is false', async () => {
      const api = fakeFilesApi();
      const up = new FileUpload(api, 'file.bin', 1000, 1, false, SEED);
      const boom = async () => { throw new Error('read failed'); };
      await expect(up.start(boom)).rejects.toThrow('read failed');
      expect(api.delete).not.toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    test('resumes with a supplied upload id', async () => {
      const api = fakeFilesApi();
      const up = new FileUpload(api, 'file.bin', 1000, 1, true, SEED);
      await up.resume(getBytes, { id: 'resumed-1', progress: {} });
      expect(api.startUpload).not.toHaveBeenCalled();
      expect(api.completeUpload).toHaveBeenCalledTimes(1);
      const [id] = api.completeUpload.mock.calls[0];
      expect(id).toBe('resumed-1');
      expect(up.isFinished()).toBe(true);
    });

    test('throws when no id is available to resume', async () => {
      const up = new FileUpload(fakeFilesApi(), 'file.bin', 1000, 1, true, SEED);
      await expect(up.resume(getBytes)).rejects.toThrow('No upload ID provided');
    });
  });
});
