const { SystemAPI } = require('../../dist/index.cjs');

function fakeApi(responses = {}) {
  return {
    get: jest.fn(async () => responses.get ?? { data: {} }),
    post: jest.fn(async () => responses.post ?? { data: {} }),
    put: jest.fn(async () => responses.put ?? { data: {} }),
    delete: jest.fn(async () => responses.delete ?? { data: {} }),
  };
}

describe('SystemAPI', () => {
  test('info fetches /info and returns the body', async () => {
    const api = fakeApi({ get: { data: { version: '2.1.0' } } });
    const system = new SystemAPI(api, {});
    const res = await system.info();
    expect(api.get).toHaveBeenCalledWith('info');
    expect(res).toEqual({ version: '2.1.0' });
  });

  test('info caches the response (only one HTTP call)', async () => {
    const api = fakeApi({ get: { data: { version: '2.1.0' } } });
    const system = new SystemAPI(api, {});
    await system.info();
    await system.info();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  test('stats fetches /stats and forwards the password as a query param', async () => {
    const api = fakeApi({ get: { data: { notes: 5 } } });
    const system = new SystemAPI(api, {});
    const res = await system.stats('secret');
    expect(api.get).toHaveBeenCalledWith('stats', { params: { password: 'secret' } });
    expect(res).toEqual({ notes: 5 });
  });

  test('stats works without a password', async () => {
    const api = fakeApi({ get: { data: {} } });
    const system = new SystemAPI(api, {});
    await system.stats();
    expect(api.get).toHaveBeenCalledWith('stats', { params: { password: undefined } });
  });
});
