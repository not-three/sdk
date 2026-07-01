const { FilesAPI } = require('../../dist/index.cjs');

function fakeApi(responses = {}) {
  return {
    get: jest.fn(async () => responses.get ?? { data: {} }),
    post: jest.fn(async () => responses.post ?? { data: {} }),
    put: jest.fn(async () => responses.put ?? { data: {} }),
    delete: jest.fn(async () => responses.delete ?? { data: {} }),
  };
}

// Note: uploadChunk() uses the module-level `axios` import (a raw PUT to a
// presigned URL) rather than the injected instance, and axios is bundled into
// dist/index.cjs, so it cannot be intercepted here. It is exercised indirectly
// through FileUpload's integration test via an injected fake FilesAPI.

describe('FilesAPI', () => {
  test('startUpload posts the name and returns the upload id', async () => {
    const api = fakeApi({ post: { data: { id: 'u1' } } });
    const files = new FilesAPI(api, {});
    const id = await files.startUpload('photo.png');
    expect(api.post).toHaveBeenCalledWith('file/upload', { name: 'photo.png' });
    expect(id).toBe('u1');
  });

  test('getUploadChunkURL passes length and part as query params', async () => {
    const api = fakeApi({ get: { data: { url: 'https://s3/put' } } });
    const files = new FilesAPI(api, {});
    const url = await files.getUploadChunkURL('u1', 1234, 2);
    expect(api.get).toHaveBeenCalledWith('file/upload/u1', { params: { length: 1234, part: 2 } });
    expect(url).toBe('https://s3/put');
  });

  test('completeUpload puts the etags', async () => {
    const api = fakeApi();
    const files = new FilesAPI(api, {});
    await files.completeUpload('u1', ['e1', 'e2']);
    expect(api.put).toHaveBeenCalledWith('file/upload/u1', { etags: ['e1', 'e2'] });
  });

  test('getFile requests json and returns the body', async () => {
    const api = fakeApi({ get: { data: { size: 10, url: 'https://cdn/file' } } });
    const files = new FilesAPI(api, {});
    const res = await files.getFile('f1');
    expect(api.get).toHaveBeenCalledWith('file/f1', { params: { json: true } });
    expect(res).toEqual({ size: 10, url: 'https://cdn/file' });
  });

  test('delete removes the file by id', async () => {
    const api = fakeApi();
    const files = new FilesAPI(api, {});
    await files.delete('f1');
    expect(api.delete).toHaveBeenCalledWith('file/f1');
  });

  test('getList fetches /file and returns the body', async () => {
    const api = fakeApi({ get: { data: [{ id: 'f1' }] } });
    const files = new FilesAPI(api, {});
    const res = await files.getList();
    expect(api.get).toHaveBeenCalledWith('file');
    expect(res).toEqual([{ id: 'f1' }]);
  });
});
