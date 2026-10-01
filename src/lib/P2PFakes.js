/**
 * In-memory doubles for the P2P test suites.
 *
 * Nothing in here is shipped: the file is never imported from `src/index.ts`,
 * it exists so the P2P state machines can be exercised offline, without a
 * browser, a signaling server, or a real WebRTC stack.
 */

const OPEN = 'open';
const CLOSED = 'closed';

/**
 * One end of a linked, in-memory data channel pair.
 *
 * `send()` hands the frame to the peer's `onmessage` on a microtask, so frame
 * ordering matches a real reliable/ordered channel. `bufferedAmount` grows with
 * every send and drains on a macrotask, firing `onbufferedamountlow` — enough
 * to drive the sender's backpressure path. Set `autoDrain = false` to park the
 * buffer high and drain it manually with `drain()`.
 */
class FakeDataChannel {
  constructor(label) {
    this.label = label;
    this.readyState = 'connecting';
    this.binaryType = 'blob';
    this.bufferedAmount = 0;
    this.bufferedAmountLowThreshold = 0;
    this.autoDrain = true;
    this.deliveryDelayMs = null;
    this.peer = null;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.onbufferedamountlow = null;
    this.sent = [];
    this._corruptNext = null;
    this._drainScheduled = false;
  }

  /** Create a linked pair of channels. */
  static createPair(label) {
    const a = new FakeDataChannel(label);
    const b = new FakeDataChannel(label);
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  /** Mutate the next binary frame in flight, to simulate corruption. */
  corruptNext(fn) {
    this._corruptNext = fn;
  }

  send(data) {
    if (this.readyState !== OPEN) throw new Error('FakeDataChannel is not open');
    this.sent.push(data);
    this.bufferedAmount += typeof data === 'string' ? data.length : data.byteLength;

    let payload = data;
    if (typeof payload !== 'string' && this._corruptNext) {
      const fn = this._corruptNext;
      this._corruptNext = null;
      const copy = new Uint8Array(payload.slice(0));
      fn(copy);
      payload = copy.buffer;
    }

    const peer = this.peer;
    const deliver = () => {
      if (!peer || peer.readyState !== OPEN) return;
      if (peer.onmessage) peer.onmessage({ data: payload });
    };
    if (this.deliveryDelayMs === null) queueMicrotask(deliver);
    else setTimeout(deliver, this.deliveryDelayMs);

    if (this.autoDrain) this._scheduleDrain();
  }

  _scheduleDrain() {
    if (this._drainScheduled) return;
    this._drainScheduled = true;
    setTimeout(() => {
      this._drainScheduled = false;
      // Re-check: a test may have switched to manual draining in the meantime.
      if (this.autoDrain) this.drain();
    }, 0);
  }

  /** Empty the send buffer and fire `onbufferedamountlow` if it was above the threshold. */
  drain() {
    const was = this.bufferedAmount;
    this.bufferedAmount = 0;
    if (was > this.bufferedAmountLowThreshold && this.onbufferedamountlow) {
      this.onbufferedamountlow({});
    }
  }

  /** Mark the channel open and fire `onopen`. */
  open() {
    if (this.readyState === OPEN) return;
    this.readyState = OPEN;
    if (this.onopen) this.onopen({});
  }

  close() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    if (this.onclose) this.onclose({});
    const peer = this.peer;
    if (peer && peer.readyState !== CLOSED) queueMicrotask(() => peer.close());
  }
}

/** A fake `RTCPeerConnection` half, wired to its counterpart through a hub. */
class FakePeerConnection {
  constructor(role, hub) {
    this.role = role;
    this.hub = hub;
    this.sctp = { maxMessageSize: hub.maxMessageSize };
    this.connectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.onicecandidate = null;
    this.ondatachannel = null;
    this.onconnectionstatechange = null;
    this.closed = false;
    this._localChannel = null;
    this._remoteChannel = null;
    this._localSet = false;
    this._remoteSet = false;
  }

  createDataChannel(label) {
    const [local, remote] = FakeDataChannel.createPair(label);
    this._localChannel = local;
    this.hub.pendingRemoteChannel = remote;
    return local;
  }

  async createOffer() {
    return { type: 'offer', sdp: `fake-offer-${this.hub.id}` };
  }

  async createAnswer() {
    return { type: 'answer', sdp: `fake-answer-${this.hub.id}` };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
    this._localSet = true;
    // Trickle a single fake candidate, like a real implementation would.
    queueMicrotask(() => {
      if (this.closed) return;
      if (this.onicecandidate) {
        this.onicecandidate({ candidate: { candidate: `fake-candidate-${this.role}` } });
      }
    });
    this.hub.maybeEstablish();
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
    this._remoteSet = true;
    this.hub.maybeEstablish();
  }

  async addIceCandidate() {
    // Candidates are irrelevant for the in-memory link.
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.connectionState = CLOSED;
    if (this._localChannel) this._localChannel.close();
    if (this._remoteChannel) this._remoteChannel.close();
    if (this.onconnectionstatechange) this.onconnectionstatechange({});
  }
}

/**
 * Build a linked sender/receiver `RTCFactory` pair.
 * @param opts.maxMessageSize The SCTP max message size both sides report.
 */
function createFakeRtcPair(opts = {}) {
  const hub = {
    id: Math.floor(performance.now() * 1000) % 100000,
    maxMessageSize: opts.maxMessageSize ?? 262144,
    pendingRemoteChannel: null,
    established: false,
    sender: null,
    receiver: null,
    maybeEstablish() {
      if (this.established) return;
      const s = this.sender;
      const r = this.receiver;
      if (!s || !r) return;
      if (!(s._localSet && s._remoteSet && r._localSet && r._remoteSet)) return;
      if (!this.pendingRemoteChannel || !s._localChannel) return;
      this.established = true;
      s.connectionState = 'connected';
      r.connectionState = 'connected';
      const remote = this.pendingRemoteChannel;
      r._remoteChannel = remote;
      queueMicrotask(() => {
        s._localChannel.open();
        remote.open();
        if (r.ondatachannel) r.ondatachannel({ channel: remote });
      });
    },
  };

  const sender = new FakePeerConnection('sender', hub);
  const receiver = new FakePeerConnection('receiver', hub);
  hub.sender = sender;
  hub.receiver = receiver;

  return {
    hub,
    senderFactory: () => sender,
    receiverFactory: () => receiver,
  };
}

/** Build a `WebSocket` constructor bound to a {@link LoopbackSignalingServer}. */
function loopbackWebSocketClass(server) {
  return class LoopbackWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      this.session = null;
      this.role = null;
      server.sockets.push(this);
      queueMicrotask(() => {
        this.readyState = 1;
        if (this.onopen) this.onopen({});
      });
    }

    send(raw) {
      if (this.readyState !== 1) throw new Error('LoopbackWebSocket is not open');
      server.handle(this, JSON.parse(raw));
    }

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      server.disconnect(this);
      if (this.onclose) this.onclose({ code: 1000 });
    }

    /** Deliver a server frame to this socket. */
    deliver(frame) {
      queueMicrotask(() => {
        if (this.readyState !== 1 || !this.onmessage) return;
        this.onmessage({ data: JSON.stringify(frame) });
      });
    }
  };
}

/**
 * The API's `/p2p` gateway, implemented in memory for two fake WebSockets.
 *
 * Speaks the exact wire protocol the real gateway does: create / join /
 * signal / leave in, created / joined / peer-joined / signal / peer-left /
 * error out.
 */
class LoopbackSignalingServer {
  constructor(opts = {}) {
    this.sessions = new Map();
    this.counter = 0;
    this.iceServers = opts.iceServers ?? [];
    this.sockets = [];
  }

  /** A `WebSocket` constructor bound to this server. */
  connectFactory() {
    return loopbackWebSocketClass(this);
  }

  handle(socket, msg) {
    switch (msg.type) {
      case 'create': {
        const sessionId = `sess-${++this.counter}`;
        const session = { id: sessionId, sender: socket, receiver: null };
        this.sessions.set(sessionId, session);
        socket.session = session;
        socket.role = 'sender';
        socket.deliver({ type: 'created', sessionId, iceServers: this.iceServers });
        break;
      }
      case 'join': {
        const session = this.sessions.get(msg.sessionId);
        if (!session) return socket.deliver({ type: 'error', code: 'not-found' });
        if (session.receiver) return socket.deliver({ type: 'error', code: 'session-full' });
        session.receiver = socket;
        socket.session = session;
        socket.role = 'receiver';
        socket.deliver({ type: 'joined', iceServers: this.iceServers });
        session.sender.deliver({ type: 'peer-joined' });
        break;
      }
      case 'signal': {
        const other = this.counterpart(socket);
        if (other) other.deliver({ type: 'signal', payload: msg.payload });
        break;
      }
      case 'leave':
        this.disconnect(socket);
        break;
    }
  }

  counterpart(socket) {
    const session = socket.session;
    if (!session) return null;
    return socket.role === 'sender' ? session.receiver : session.sender;
  }

  disconnect(socket) {
    const session = socket.session;
    if (!session) return;
    const other = this.counterpart(socket);
    socket.session = null;
    if (socket.role === 'sender') {
      this.sessions.delete(session.id);
      session.sender = null;
    } else if (session.receiver === socket) {
      session.receiver = null;
    }
    if (other) other.deliver({ type: 'peer-left' });
  }
}

module.exports = { FakeDataChannel, FakePeerConnection, createFakeRtcPair, LoopbackSignalingServer };
