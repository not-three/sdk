const {
  Not3Client,
  P2PReceiver,
  P2PProtocol,
  P2PSignaling,
  Crypto,
  connectPeer,
  P2PPeerAuthFailedError,
  P2PTransferCorruptedError,
  P2PPeerDisconnectedError,
} = require('../../dist/index.cjs');
const { LoopbackSignalingServer, createFakeRtcPair } = require('./P2PFakes');

const MAX_MESSAGE_SIZE = 1024;
const CPS = P2PProtocol.chunkPayloadSize(MAX_MESSAGE_SIZE);

/** Deterministic file contents. */
function fixture(size) {
  const u = new Uint8Array(size);
  for (let i = 0; i < size; i++) u[i] = (i * 7 + 11) & 0xff;
  return u;
}

function chunkOf(data, index) {
  return data.slice(index * CPS, Math.min((index + 1) * CPS, data.length))
    .buffer;
}

/** The scripted peer: raw sender-side channel driven by hand. */
class Script {
  constructor(channel, key) {
    this.channel = channel;
    this.key = key;
    this.incoming = [];
    this.waiters = [];
    channel.onmessage = (ev) => {
      if (this.waiters.length) this.waiters.shift()(ev.data);
      else this.incoming.push(ev.data);
    };
  }

  /** Await and decrypt the next control message from the receiver. */
  async next() {
    const raw = this.incoming.length
      ? this.incoming.shift()
      : await new Promise((r) => this.waiters.push(r));
    return P2PProtocol.decryptControl(raw, this.key);
  }

  async send(msg, key = this.key) {
    this.channel.send(await P2PProtocol.encryptControl(msg, key));
  }

  async sendChunk(index, payload, { corrupt = false } = {}) {
    const enc = new Uint8Array(
      await P2PProtocol.encryptChunk(index, payload, this.key),
    );
    if (corrupt) enc[enc.length - 1] ^= 0xff;
    this.channel.send(enc.buffer);
  }
}

async function harness(opts = {}) {
  const seed = opts.seed ?? Crypto.generateSeed();
  const key = await Crypto.generateKey(seed, 'gcm');
  const server = new LoopbackSignalingServer();
  const WS = server.connectFactory();
  const { senderFactory, receiverFactory } = createFakeRtcPair({
    maxMessageSize: MAX_MESSAGE_SIZE,
  });

  const senderSig = new P2PSignaling('ws://fake/p2p', WS);
  await senderSig.connect();
  const { sessionId } = await senderSig.create();
  const peerJoined = new Promise((r) => {
    senderSig.onPeerJoined = r;
  });

  const client = new Not3Client({
    baseUrl: 'https://api.x/',
    webSocket: WS,
    rtc: receiverFactory,
  });
  const receiver = new P2PReceiver(client.p2p(), sessionId, seed);

  const script = (async () => {
    await peerJoined;
    const { channel } = await connectPeer({
      role: 'sender',
      signaling: senderSig,
      rtc: senderFactory,
      iceServers: [],
    });
    return new Script(channel, key);
  })();

  return { receiver, seed, key, server, script };
}

/** Start the receiver, recording every write and progress state. */
function collect(receiver, resumeOffset) {
  const writes = [];
  const states = [];
  const progress = [];
  receiver.onProgress((p) => {
    states.push(p.state);
    progress.push({ ...p });
  });
  const done = receiver.start(async (buf, index) => {
    writes.push({ index, bytes: new Uint8Array(buf) });
  }, resumeOffset);
  return { writes, states, progress, done };
}

describe('P2PReceiver', () => {
  test('a gateway error after joining reaches the transfer caller', async () => {
    const { receiver, server, script } = await harness();
    const { done } = collect(receiver);
    await script;

    server.sockets
      .find((socket) => socket.role === 'receiver')
      .deliver({
        type: 'error',
        code: 'invalid-message',
      });

    await expect(done).rejects.toMatchObject({ code: 'invalid-message' });
  });

  test('happy path: meta, accept, three chunks, done, complete', async () => {
    const { receiver, script } = await harness();
    const size = Math.floor(CPS * 2.5);
    const data = fixture(size);
    const { writes, states, progress, done } = collect(receiver);

    const s = await script;
    await s.send({ t: 'meta', name: 'a.bin', size, chunkPayloadSize: CPS });
    expect(await s.next()).toEqual({ t: 'accept', offset: 0 });
    await expect(receiver.getMeta()).resolves.toEqual({
      name: 'a.bin',
      size,
      chunkPayloadSize: CPS,
    });

    for (let i = 0; i < 3; i++) await s.sendChunk(i, chunkOf(data, i));
    await s.send({ t: 'done', chunkCount: 3 });
    expect(await s.next()).toEqual({ t: 'complete' });
    s.channel.close();
    await done;

    expect(writes.map((w) => w.index)).toEqual([0, 1, 2]);
    expect(Buffer.concat(writes.map((w) => Buffer.from(w.bytes)))).toEqual(
      Buffer.from(data),
    );
    expect(states.filter((v, i, a) => a[i - 1] !== v)).toEqual([
      'connecting',
      'handshake',
      'transfer',
      'done',
    ]);
    expect(progress[progress.length - 1]).toEqual({
      state: 'done',
      bytesTransferred: size,
      totalBytes: size,
    });
  });

  test('manual acceptance exposes metadata without accepting or buffering early chunks', async () => {
    const { receiver, script } = await harness();
    const writes = [];
    const done = receiver.start(
      async (buf) => writes.push(new Uint8Array(buf)),
      { manualAccept: true },
    );
    const s = await script;
    await s.send({
      t: 'meta',
      name: 'consent.bin',
      size: 3,
      chunkPayloadSize: CPS,
    });
    await expect(receiver.getMeta()).resolves.toEqual({
      name: 'consent.bin',
      size: 3,
      chunkPayloadSize: CPS,
    });
    const queueBefore = receiver.queue;
    await s.sendChunk(0, new Uint8Array([8, 8, 8]).buffer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(receiver.queue).toBe(queueBefore); // pre-consent binary frames never enter the work queue
    expect(s.channel.peer.sent).toEqual([]);
    expect(writes).toEqual([]);
    await receiver.accept();
    expect(await s.next()).toEqual({ t: 'accept', offset: 0 });
    expect(writes).toEqual([]);
    await s.sendChunk(0, new Uint8Array([1, 2, 3]).buffer);
    await s.send({ t: 'done', chunkCount: 1 });
    expect(await s.next()).toEqual({ t: 'complete' });
    s.channel.close();
    await done;
    expect(writes).toEqual([new Uint8Array([1, 2, 3])]);
  });

  test('manual rejection finishes promptly if the peer closes before its abort drains', async () => {
    const oldTimeout = P2PProtocol.CONTROL_TIMEOUT_MS;
    P2PProtocol.CONTROL_TIMEOUT_MS = 50;
    try {
      const { receiver, script } = await harness();
      const done = receiver.start(async () => {}, { manualAccept: true });
      done.catch(() => {});
      const s = await script;
      await s.send({
        t: 'meta',
        name: 'a.bin',
        size: 10,
        chunkPayloadSize: CPS,
      });
      await receiver.getMeta();
      s.channel.peer.autoDrain = false;
      const rejecting = receiver.reject();
      setTimeout(() => s.channel.close(), 5);
      await expect(
        Promise.race([
          rejecting,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('reject hung after close')), 20),
          ),
        ]),
      ).resolves.toBeUndefined();
      await expect(done).rejects.toMatchObject({ code: 'cancelled' });
    } finally {
      P2PProtocol.CONTROL_TIMEOUT_MS = oldTimeout;
    }
  });

  test('resume rounds the offset down to a chunk boundary', async () => {
    const { receiver, script } = await harness();
    const size = Math.floor(CPS * 2.5);
    const data = fixture(size);
    const { writes, done } = collect(receiver, Math.floor(CPS * 1.5));

    const s = await script;
    await s.send({ t: 'meta', name: 'a.bin', size, chunkPayloadSize: CPS });
    expect(await s.next()).toEqual({ t: 'accept', offset: CPS });

    for (let i = 1; i < 3; i++) await s.sendChunk(i, chunkOf(data, i));
    await s.send({ t: 'done', chunkCount: 3 });
    expect(await s.next()).toEqual({ t: 'complete' });
    s.channel.close();
    await done;

    expect(writes.map((w) => w.index)).toEqual([1, 2]);
    expect(writes[0].bytes).toEqual(new Uint8Array(chunkOf(data, 1)));
  });

  test('meta encrypted with the wrong seed fails peer authentication', async () => {
    const { receiver, script } = await harness();
    const { done } = collect(receiver);
    const s = await script;
    const wrongKey = await Crypto.generateKey(Crypto.generateSeed(), 'gcm');
    await s.send(
      { t: 'meta', name: 'a.bin', size: 10, chunkPayloadSize: CPS },
      wrongKey,
    );
    await expect(done).rejects.toBeInstanceOf(P2PPeerAuthFailedError);
  });

  test('a corrupted chunk is nacked and the rewind completes the transfer', async () => {
    const { receiver, script } = await harness();
    const size = Math.floor(CPS * 2.5);
    const data = fixture(size);
    const { writes, done } = collect(receiver);

    const s = await script;
    await s.send({ t: 'meta', name: 'a.bin', size, chunkPayloadSize: CPS });
    expect(await s.next()).toEqual({ t: 'accept', offset: 0 });

    await s.sendChunk(0, chunkOf(data, 0));
    await s.sendChunk(1, chunkOf(data, 1), { corrupt: true });
    expect(await s.next()).toEqual({ t: 'nack', index: 1 });

    await s.sendChunk(1, chunkOf(data, 1));
    await s.sendChunk(2, chunkOf(data, 2));
    await s.send({ t: 'done', chunkCount: 3 });
    expect(await s.next()).toEqual({ t: 'complete' });
    s.channel.close();
    await done;

    expect(writes.map((w) => w.index)).toEqual([0, 1, 2]);
    expect(Buffer.concat(writes.map((w) => Buffer.from(w.bytes)))).toEqual(
      Buffer.from(data),
    );
  });

  test('one unresolved gap sends one nack despite later frames and done', async () => {
    const { receiver, key, script } = await harness();
    const size = CPS * 4;
    const data = fixture(size);
    const { writes, done } = collect(receiver);
    const s = await script;
    await s.send({ t: 'meta', name: 'gap.bin', size, chunkPayloadSize: CPS });
    expect(await s.next()).toEqual({ t: 'accept', offset: 0 });

    await s.sendChunk(0, chunkOf(data, 0), { corrupt: true });
    await s.sendChunk(1, chunkOf(data, 1));
    await s.send({ t: 'done', chunkCount: 4 });
    for (let i = 0; i < 4; i++) await s.sendChunk(i, chunkOf(data, i));
    await s.send({ t: 'done', chunkCount: 4 });
    expect(await s.next()).toEqual({ t: 'nack', index: 0 });
    expect(await s.next()).toEqual({ t: 'complete' });
    s.channel.close();
    await done;

    const controls = await Promise.all(
      s.channel.peer.sent
        .filter((frame) => typeof frame === 'string')
        .map((frame) => P2PProtocol.decryptControl(frame, key)),
    );
    expect(controls.filter((msg) => msg.t === 'nack')).toEqual([
      { t: 'nack', index: 0 },
    ]);
    expect(writes.map((write) => write.index)).toEqual([0, 1, 2, 3]);
  });

  test('persistent corruption aborts with P2PTransferCorruptedError', async () => {
    const { receiver, script } = await harness();
    const size = Math.floor(CPS * 2.5);
    const data = fixture(size);
    const { done } = collect(receiver);

    const s = await script;
    await s.send({ t: 'meta', name: 'a.bin', size, chunkPayloadSize: CPS });
    expect(await s.next()).toEqual({ t: 'accept', offset: 0 });

    await s.sendChunk(0, chunkOf(data, 0));
    for (let attempt = 0; attempt < P2PProtocol.NACK_RETRY_LIMIT; attempt++) {
      await s.sendChunk(1, chunkOf(data, 1), { corrupt: true });
      expect(await s.next()).toEqual({ t: 'nack', index: 1 });
    }
    await s.sendChunk(1, chunkOf(data, 1), { corrupt: true });
    await expect(done).rejects.toBeInstanceOf(P2PTransferCorruptedError);
  });

  test('a skipped index is nacked', async () => {
    const { receiver, script } = await harness();
    const size = Math.floor(CPS * 2.5);
    const data = fixture(size);
    collect(receiver);

    const s = await script;
    await s.send({ t: 'meta', name: 'a.bin', size, chunkPayloadSize: CPS });
    expect(await s.next()).toEqual({ t: 'accept', offset: 0 });

    await s.sendChunk(0, chunkOf(data, 0));
    await s.sendChunk(2, chunkOf(data, 2));
    expect(await s.next()).toEqual({ t: 'nack', index: 1 });
  });

  test('an empty file completes without any writes', async () => {
    const { receiver, script } = await harness();
    const { writes, done } = collect(receiver);

    const s = await script;
    await s.send({
      t: 'meta',
      name: 'empty.bin',
      size: 0,
      chunkPayloadSize: CPS,
    });
    expect(await s.next()).toEqual({ t: 'accept', offset: 0 });
    await s.send({ t: 'done', chunkCount: 0 });
    expect(await s.next()).toEqual({ t: 'complete' });
    s.channel.close();
    await done;

    expect(writes).toEqual([]);
  });

  test('a peer abort mid-transfer rejects with P2PPeerDisconnectedError', async () => {
    const { receiver, script } = await harness();
    const size = Math.floor(CPS * 2.5);
    const data = fixture(size);
    const { done } = collect(receiver);

    const s = await script;
    await s.send({ t: 'meta', name: 'a.bin', size, chunkPayloadSize: CPS });
    expect(await s.next()).toEqual({ t: 'accept', offset: 0 });
    await s.sendChunk(0, chunkOf(data, 0));
    await s.send({ t: 'abort' });

    await expect(done).rejects.toBeInstanceOf(P2PPeerDisconnectedError);
  });
});
