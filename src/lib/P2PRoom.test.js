const { P2PRoom, Crypto, P2PSessionNotFoundError } = require('../../dist/index.cjs');

class Socket {
  static instances = [];
  constructor() {
    this.readyState = 0;
    this.sent = [];
    Socket.instances.push(this);
    queueMicrotask(() => { this.readyState = 1; this.onopen?.({}); });
  }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.onclose?.({}); }
  receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const client = { gatewayUrl: () => 'ws://fake/p2p', webSocketCtor: () => Socket,
  rtcFactory: () => () => { throw new Error('RTC should not start'); } };

beforeEach(() => { Socket.instances = []; });

test('create changes state and returns the room and local peer ids', async () => {
  const room = new P2PRoom(client, { seed: Crypto.generateSeed() });
  const states = [];
  room.onStateChange = (state) => states.push(state);
  const grant = room.create();
  await tick();
  expect(Socket.instances[0].sent).toEqual([{ type: 'create', kind: 'room' }]);
  Socket.instances[0].receive({ type: 'created', kind: 'room', sessionId: 'r1', peerId: 'a', iceServers: [] });
  await expect(grant).resolves.toEqual({ roomId: 'r1', peerId: 'a' });
  expect(room.state).toBe('joined');
  expect(room.peerId).toBe('a');
  expect(states).toEqual(['connecting', 'joined']);
  Socket.instances[0].receive({ type: 'peer-joined', peerId: 'b' });
  expect(room.peers()).toEqual([{ id: 'b', connected: false }]);
  room.leave();
  expect(states).toEqual(['connecting', 'joined', 'closed']);
});

test('join resolves on signaling grant and exposes existing peers before channels open', async () => {
  const room = new P2PRoom(client, { seed: Crypto.generateSeed() });
  const grant = room.join('r1');
  await tick();
  expect(Socket.instances[0].sent).toEqual([{ type: 'join', sessionId: 'r1' }]);
  Socket.instances[0].receive({ type: 'joined', kind: 'room', sessionId: 'r1', peerId: 'b', peers: ['a'], iceServers: [] });
  await expect(grant).resolves.toEqual({ peerId: 'b', peers: ['a'] });
  expect(room.peers()).toEqual([{ id: 'a', connected: false }]);
  room.leave();
});

test('gateway errors reject join with the mapped error and close room once', async () => {
  const room = new P2PRoom(client, { seed: Crypto.generateSeed() });
  const closed = [];
  room.onClose = (error) => closed.push(error);
  const grant = room.join('missing');
  await tick();
  Socket.instances[0].receive({ type: 'error', code: 'not-found' });
  await expect(grant).rejects.toBeInstanceOf(P2PSessionNotFoundError);
  expect(room.state).toBe('closed');
  expect(closed).toHaveLength(1);
  room.leave();
  expect(closed).toHaveLength(1);
});

test('signaling loss without a live channel calls onClose only', async () => {
  const lost = jest.fn();
  const room = new P2PRoom(client, { seed: Crypto.generateSeed(), onSignalingLost: lost });
  const closed = jest.fn();
  room.onClose = closed;
  const grant = room.create();
  await tick();
  Socket.instances[0].receive({ type: 'created', kind: 'room', sessionId: 'r1', peerId: 'a', iceServers: [] });
  await grant;
  Socket.instances[0].close();
  expect(lost).not.toHaveBeenCalled();
  expect(closed).toHaveBeenCalledTimes(1);
  expect(room.state).toBe('closed');
});
