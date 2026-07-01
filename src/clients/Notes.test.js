const { NotesAPI } = require('../../dist/index.cjs');

/** Build a fake AxiosInstance whose methods resolve to the given { data } payloads. */
function fakeApi(responses = {}) {
  return {
    get: jest.fn(async () => responses.get ?? { data: {} }),
    post: jest.fn(async () => responses.post ?? { data: {} }),
    put: jest.fn(async () => responses.put ?? { data: {} }),
    delete: jest.fn(async () => responses.delete ?? { data: {} }),
  };
}

describe('NotesAPI', () => {
  test('create posts to note/json and returns the response body', async () => {
    const api = fakeApi({ post: { data: { id: 'n1', token: 't1' } } });
    const notes = new NotesAPI(api, {});
    const req = { content: 'hello' };
    const res = await notes.create(req);
    expect(api.post).toHaveBeenCalledWith('note/json', req);
    expect(res).toEqual({ id: 'n1', token: 't1' });
  });

  test('get fetches note/<id>/json and returns the body', async () => {
    const api = fakeApi({ get: { data: { content: 'hi' } } });
    const notes = new NotesAPI(api, {});
    const res = await notes.get('n1');
    expect(api.get).toHaveBeenCalledWith('note/n1/json');
    expect(res).toEqual({ content: 'hi' });
  });

  test('delete sends the token in the request body', async () => {
    const api = fakeApi();
    const notes = new NotesAPI(api, {});
    await notes.delete('n1', 'tok');
    expect(api.delete).toHaveBeenCalledWith('note/n1', { data: { token: 'tok' } });
  });

  test('delete works without a token', async () => {
    const api = fakeApi();
    const notes = new NotesAPI(api, {});
    await notes.delete('n1');
    expect(api.delete).toHaveBeenCalledWith('note/n1', { data: { token: undefined } });
  });
});
