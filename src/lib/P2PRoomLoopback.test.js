const { Not3Client, Crypto, P2PProtocol } = require('../../dist/index.cjs');
const { RoomLoopbackSignalingServer, createFakeRtcMesh } = require('./P2PFakes');

jest.setTimeout(10000);
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await tick(); }
  throw new Error('Timed out waiting for room mesh');
}

function setup() {
  const server = new RoomLoopbackSignalingServer();
  const mesh = createFakeRtcMesh();
  const WS = server.connectFactory();
  const client = new Not3Client({ baseUrl: 'https://api.x/', webSocket: WS, rtc: mesh.rtc }).p2p();
  const seed = Crypto.generateSeed();
  return { server, mesh, client, seed };
}

async function pair(h) {
  const a = h.client.room({ seed: h.seed });
  const { roomId } = await a.create();
  const b = h.client.room({ seed: h.seed });
  await b.join(roomId);
  await until(() => a.peers().some((p) => p.connected) && b.peers().some((p) => p.connected));
  return { a, b, roomId };
}

test('three members route broadcast and direct messages, then survive one leave', async () => {
  const h = setup();
  const { a, b, roomId } = await pair(h);
  const c = h.client.room({ seed: h.seed });
  await c.join(roomId);
  await until(() => [a, b, c].every((room) => room.peers().filter((p) => p.connected).length === 2));
  const got = { a: [], b: [], c: [] };
  a.onMessage = (id, data) => got.a.push([id, data]);
  b.onMessage = (id, data) => got.b.push([id, data]);
  c.onMessage = (id, data) => got.c.push([id, data]);
  try {
    await a.broadcast(new Uint8Array([1, 2, 3]));
    await until(() => got.b.length === 1 && got.c.length === 1);
    expect(new Uint8Array(got.b[0][1])).toEqual(new Uint8Array([1, 2, 3]));
    expect(got.b[0][0]).toBe(a.peerId);
    expect(new Uint8Array(got.c[0][1])).toEqual(new Uint8Array([1, 2, 3]));
    await c.send(b.peerId, 'private');
    await until(() => got.b.length === 2);
    expect(got.b[1]).toEqual([c.peerId, 'private']);
    expect(got.a).toEqual([]);
    b.leave();
    await until(() => a.peers().length === 1 && c.peers().length === 1);
    await a.send(c.peerId, 'after leave');
    await until(() => got.c.length === 2);
    expect(got.c[1]).toEqual([a.peerId, 'after leave']);
  } finally { a.leave(); b.leave(); c.leave(); }
});

test('send rejects oversized string and binary wire frames', async () => {
  const h = setup();
  const { a, b } = await pair(h);
  try {
    await expect(a.send(b.peerId, new Uint8Array(P2PProtocol.MAX_MESSAGE_SIZE))).rejects.toThrow('maximum size');
    await expect(a.send(b.peerId, 'x'.repeat(P2PProtocol.MAX_MESSAGE_SIZE))).rejects.toThrow('maximum size');
    expect(b.peers()[0].connected).toBe(true);
  } finally { a.leave(); b.leave(); }
});

test('an application message handler error does not disconnect its peer', async () => {
  const h = setup();
  const { a, b } = await pair(h);
  try {
    b.onMessage = () => { throw new Error('application handler failed'); };
    await a.send(b.peerId, 'first');
    await tick();
    expect(a.peers()[0].connected).toBe(true);
    expect(b.peers()[0].connected).toBe(true);
    const got = [];
    b.onMessage = (_, data) => got.push(data);
    await a.send(b.peerId, 'second');
    await until(() => got.length === 1);
    expect(got).toEqual(['second']);
  } finally { a.leave(); b.leave(); }
});

test('wrong seed closes only that peer and leaves good peers connected', async () => {
  const h = setup();
  const { a, b, roomId } = await pair(h);
  const bad = h.client.room({ seed: Crypto.generateSeed() });
  const left = [];
  a.onPeerLeft = (id) => left.push(id);
  try {
    await bad.join(roomId);
    await until(() => a.peers().some((p) => p.id === bad.peerId && p.connected));
    await bad.send(a.peerId, 'bad key');
    await until(() => left.includes(bad.peerId));
    expect(a.peers()).toEqual([{ id: b.peerId, connected: true }]);
    const received = [];
    b.onMessage = (id, data) => received.push([id, data]);
    await a.send(b.peerId, 'still working');
    await until(() => received.length === 1);
    expect(received).toEqual([[a.peerId, 'still working']]);
  } finally { a.leave(); b.leave(); bad.leave(); }
});

test.each(['close', 'error'])('signaling %s with a live channel notifies once and leaves messages flowing', async (failure) => {
  const h = setup();
  const lost = jest.fn();
  const a = h.client.room({ seed: h.seed, onSignalingLost: lost });
  const { roomId } = await a.create();
  const b = h.client.room({ seed: h.seed });
  await b.join(roomId);
  await until(() => a.peers()[0]?.connected && b.peers()[0]?.connected);
  const closed = jest.fn();
  a.onClose = closed;
  const got = [];
  b.onMessage = (id, data) => got.push(data);
  try {
    const socket = h.server.sockets.find((member) => member.peerId === a.peerId);
    if (failure === 'close') socket.close();
    else socket.onerror?.({});
    await until(() => lost.mock.calls.length === 1);
    expect(a.state).toBe('joined');
    expect(closed).not.toHaveBeenCalled();
    await a.send(b.peerId, 'still here');
    await until(() => got.length === 1);
    expect(got).toEqual(['still here']);
    a.leave();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(lost).toHaveBeenCalledTimes(1);
  } finally { a.leave(); b.leave(); }
});
