const { Not3Client, P2PRoom, Crypto } = require('../../dist/index.cjs');

function clientWith(baseUrl, extra = {}) {
  return new Not3Client({ baseUrl, ...extra });
}

describe('P2PClient', () => {
  test('gatewayUrl derives ws(s) url from baseUrl', () => {
    expect(clientWith('https://api.x/').p2p().gatewayUrl()).toBe('wss://api.x/p2p');
    expect(clientWith('http://localhost:4000/').p2p().gatewayUrl()).toBe('ws://localhost:4000/p2p');
  });

  test('isEnabled reads p2pEnabled from system info', async () => {
    const p2p = clientWith('https://api.x/').p2p();
    // stub the axios instance the sub-client holds
    p2p.api = { get: jest.fn(async () => ({ data: { version: 'IN-DEV', p2pEnabled: true } })) };
    await expect(p2p.isEnabled()).resolves.toBe(true);
    p2p.api = { get: jest.fn(async () => ({ data: { version: 'IN-DEV' } })) };
    await expect(p2p.isEnabled()).resolves.toBe(false);
  });

  test('roomsEnabled reads the optional p2pRooms info flag', async () => {
    const p2p = clientWith('https://api.x/').p2p();
    p2p.api = { get: jest.fn(async () => ({ data: { p2pRooms: true } })) };
    await expect(p2p.roomsEnabled()).resolves.toBe(true);
    p2p.api = { get: jest.fn(async () => ({ data: {} })) };
    await expect(p2p.roomsEnabled()).resolves.toBe(false);
    p2p.api = { get: jest.fn(async () => ({ data: { p2pRooms: 'true' } })) };
    await expect(p2p.roomsEnabled()).resolves.toBe(false);
  });

  test('room constructs the exported room primitive', () => {
    const p2p = clientWith('https://api.x/').p2p();
    const room = p2p.room({ seed: Crypto.generateSeed() });
    expect(room).toBeInstanceOf(P2PRoom);
    expect(room.state).toBe('idle');
  });

  test('webSocketCtor and rtcFactory prefer injected options', () => {
    class FakeWS {}
    const fakeFactory = () => ({});
    const p2p = clientWith('https://api.x/', { webSocket: FakeWS, rtc: fakeFactory }).p2p();
    expect(p2p.webSocketCtor()).toBe(FakeWS);
    expect(p2p.rtcFactory()).toBe(fakeFactory);
  });

  test('rtcFactory throws a helpful error when nothing is available', () => {
    const p2p = clientWith('https://api.x/').p2p();
    const saved = globalThis.RTCPeerConnection;
    delete globalThis.RTCPeerConnection;
    try {
      expect(() => p2p.rtcFactory()).toThrow(/RTCPeerConnection/);
    } finally {
      if (saved) globalThis.RTCPeerConnection = saved;
    }
  });
});
