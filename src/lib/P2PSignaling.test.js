const { P2PSignaling, P2PSessionFullError } = require('../../dist/index.cjs');

/** Minimal scriptable WebSocket double. Instances register on FakeWebSocket.instances. */
class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.readyState = 0; // CONNECTING
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    FakeWebSocket.instances.push(this);
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; if (this.onclose) this.onclose({ code: 1000 }); }
  // test drivers:
  open() { this.readyState = 1; this.onopen && this.onopen({}); }
  receive(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
}

beforeEach(() => { FakeWebSocket.instances = []; });

async function connected() {
  const sig = new P2PSignaling('wss://api.x/p2p', FakeWebSocket);
  const p = sig.connect();
  const ws = FakeWebSocket.instances[0];
  ws.open();
  await p;
  return { sig, ws };
}

describe('P2PSignaling', () => {
  test('connect resolves once the socket opens', async () => {
    const { ws } = await connected();
    expect(ws.url).toBe('wss://api.x/p2p');
  });

  test('create sends create and resolves with session grant', async () => {
    const { sig, ws } = await connected();
    const p = sig.create();
    expect(ws.sent).toEqual([{ type: 'create' }]);
    ws.receive({ type: 'created', sessionId: 's1', iceServers: [{ urls: 'stun:s' }] });
    await expect(p).resolves.toEqual({ sessionId: 's1', iceServers: [{ urls: 'stun:s' }] });
  });

  test('join resolves with grant and rejects with typed error', async () => {
    const { sig, ws } = await connected();
    const p = sig.join('s1');
    expect(ws.sent).toEqual([{ type: 'join', sessionId: 's1' }]);
    ws.receive({ type: 'joined', iceServers: [] });
    await expect(p).resolves.toEqual({ sessionId: 's1', iceServers: [] });

    const p2 = sig.join('s1');
    ws.receive({ type: 'error', code: 'session-full' });
    await expect(p2).rejects.toBeInstanceOf(P2PSessionFullError);
  });

  test('signal frames dispatch to onSignal, peer events to their handlers', async () => {
    const { sig, ws } = await connected();
    const got = [];
    sig.onSignal = (payload) => got.push(payload);
    let joined = 0; let left = 0;
    sig.onPeerJoined = () => joined++;
    sig.onPeerLeft = () => left++;
    ws.receive({ type: 'peer-joined' });
    ws.receive({ type: 'signal', payload: { sdp: 'x' } });
    ws.receive({ type: 'peer-left' });
    expect(joined).toBe(1);
    expect(got).toEqual([{ sdp: 'x' }]);
    expect(left).toBe(1);
  });

  test('sendSignal wraps payload; leave sends and closes', async () => {
    const { sig, ws } = await connected();
    sig.sendSignal({ candidate: 'c' });
    expect(ws.sent).toEqual([{ type: 'signal', payload: { candidate: 'c' } }]);
    sig.leave();
    expect(ws.sent[1]).toEqual({ type: 'leave' });
    expect(ws.readyState).toBe(3);
  });

  test('socket close after setup fires onClose', async () => {
    const { sig, ws } = await connected();
    let closed = 0;
    sig.onClose = () => closed++;
    ws.close();
    expect(closed).toBe(1);
  });

  test('a server error frame without a pending request reports via onClose', async () => {
    const { sig, ws } = await connected();
    const seen = [];
    sig.onClose = (err) => seen.push(err);
    ws.receive({ type: 'error', code: 'rate-limited' });
    expect(seen).toHaveLength(1);
    expect(seen[0].code).toBe('rate-limited');
  });

  test('malformed json closes the socket with an error', async () => {
    const { sig, ws } = await connected();
    const seen = [];
    sig.onClose = (err) => seen.push(err);
    ws.onmessage({ data: 'not json' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(Error);
    expect(ws.readyState).toBe(3);
  });

  test('sending before the socket is open throws', () => {
    const sig = new P2PSignaling('wss://api.x/p2p', FakeWebSocket);
    expect(() => sig.sendSignal({})).toThrow('Signaling socket not open');
  });

  test('two in-flight requests are refused', async () => {
    const { sig } = await connected();
    sig.create();
    await expect(sig.create()).rejects.toThrow('Another signaling request is in flight');
  });
});
