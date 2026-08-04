const {
  Not3Client, P2PSender, P2PProtocol, P2PSignaling, Crypto, connectPeer,
  P2PTransferCorruptedError,
} = require('../../dist/index.cjs');
const { LoopbackSignalingServer, createFakeRtcPair } = require('./P2PFakes');

const MAX_MESSAGE_SIZE = 1024;
const CPS = P2PProtocol.chunkPayloadSize(MAX_MESSAGE_SIZE);

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function fixture(size) {
  const u = new Uint8Array(size);
  for (let i = 0; i < size; i++) u[i] = (i * 13 + 5) & 0xff;
  return u;
}

function chunkOf(data, index) {
  return data.slice(index * CPS, Math.min((index + 1) * CPS, data.length)).buffer;
}

/**
 * Hands out linked fake peer connections. The scripted receiver creates a pair
 * before it joins, so the sender's factory always finds one waiting.
 */
function rtcBroker(maxMessageSize) {
  const ready = [];
  return {
    createPair() {
      const pair = createFakeRtcPair({ maxMessageSize });
      ready.push(pair);
      return pair;
    },
    senderRtc: (config) => {
      const pair = ready.shift();
      if (!pair) throw new Error('no fake rtc pair available');
      return pair.senderFactory(config);
    },
  };
}

/** The scripted peer: raw receiver-side channel driven by hand. */
class ReceiverScript {
  constructor(channel, key, signaling, pair) {
    this.channel = channel;
    this.key = key;
    this.signaling = signaling;
    this.pair = pair;
    this.frames = [];
    this.waiters = [];
    this.seenControls = [];
    this.binaryCount = 0;
    channel.onmessage = (ev) => {
      const frame =
        typeof ev.data === 'string'
          ? P2PProtocol.decryptControl(ev.data, key).then((value) => {
              this.seenControls.push(value);
              return { kind: 'control', value };
            })
          : P2PProtocol.decryptChunk(ev.data, key).then((value) => ({ kind: 'chunk', value }));
      if (typeof ev.data !== 'string') this.binaryCount++;
      if (this.waiters.length) this.waiters.shift()(frame);
      else this.frames.push(frame);
    };
  }

  next() {
    return this.frames.length
      ? this.frames.shift()
      : new Promise((r) => this.waiters.push(r));
  }

  async nextControl() {
    const frame = await this.next();
    if (frame.kind !== 'control') throw new Error(`expected a control frame, got ${frame.kind}`);
    return frame.value;
  }

  async nextChunk() {
    const frame = await this.next();
    if (frame.kind !== 'chunk') throw new Error(`expected a chunk frame, got ${frame.kind}`);
    return frame.value;
  }

  async send(msg, key = this.key) {
    this.channel.send(await P2PProtocol.encryptControl(msg, key));
  }

  /** The sender's end of the link, so tests can meddle with backpressure. */
  senderChannel() {
    return this.pair.hub.sender._localChannel;
  }
}

async function harness({ name = 'file.bin', size, seed, maxMessageSize = MAX_MESSAGE_SIZE } = {}) {
  const server = new LoopbackSignalingServer();
  const WS = server.connectFactory();
  const broker = rtcBroker(maxMessageSize);
  const client = new Not3Client({ baseUrl: 'https://api.x/', webSocket: WS, rtc: broker.senderRtc });
  const sender = new P2PSender(client.p2p(), name, size, seed ? { seed } : undefined);
  const key = await Crypto.generateKey(sender.getSeed(), 'gcm');

  const states = [];
  let waitingResolve;
  const waitingPeer = new Promise((r) => { waitingResolve = r; });
  sender.onProgress((p) => {
    states.push(p.state);
    if (p.state === 'waiting-peer') waitingResolve();
  });

  return { sender, key, WS, broker, states, waitingPeer };
}

async function joinAs(h) {
  await h.waitingPeer;
  const signaling = new P2PSignaling('ws://fake/p2p', h.WS);
  await signaling.connect();
  const pair = h.broker.createPair();
  await signaling.join(h.sender.getSessionId());
  const { channel } = await connectPeer({
    role: 'receiver', signaling, rtc: pair.receiverFactory, iceServers: [],
  });
  return new ReceiverScript(channel, h.key, signaling, pair);
}

const readerFor = (data) => async (start, end) => data.slice(start, end).buffer;

describe('P2PSender', () => {
  test('happy path: meta, accept, three chunks, done, complete', async () => {
    const size = Math.floor(CPS * 2.5);
    const data = fixture(size);
    const h = await harness({ size });
    const done = h.sender.start(readerFor(data));

    const s = await joinAs(h);
    expect(await s.nextControl()).toEqual({
      t: 'meta', name: 'file.bin', size, chunkPayloadSize: CPS,
    });
    await s.send({ t: 'accept', offset: 0 });

    for (let i = 0; i < 3; i++) {
      const chunk = await s.nextChunk();
      expect(chunk.index).toBe(i);
      expect(new Uint8Array(chunk.payload)).toEqual(new Uint8Array(chunkOf(data, i)));
    }
    expect(await s.nextControl()).toEqual({ t: 'done', chunkCount: 3 });
    await s.send({ t: 'complete' });
    await done;

    expect(h.sender.getProgress()).toEqual({
      state: 'done', bytesTransferred: size, totalBytes: size,
    });
    expect(h.states.filter((v, i, a) => a[i - 1] !== v)).toEqual([
      'connecting', 'waiting-peer', 'handshake', 'transfer', 'done',
    ]);
  });

  test('an accept with an offset resumes at that chunk', async () => {
    const size = Math.floor(CPS * 2.5);
    const data = fixture(size);
    const h = await harness({ size });
    const done = h.sender.start(readerFor(data));

    const s = await joinAs(h);
    await s.nextControl();
    await s.send({ t: 'accept', offset: CPS * 2 });

    const chunk = await s.nextChunk();
    expect(chunk.index).toBe(2);
    expect(new Uint8Array(chunk.payload)).toEqual(new Uint8Array(chunkOf(data, 2)));
    expect(await s.nextControl()).toEqual({ t: 'done', chunkCount: 3 });
    await s.send({ t: 'complete' });
    await done;
  });

  test('a nack rewinds the stream and the transfer still completes', async () => {
    const size = Math.floor(CPS * 2.5);
    const data = fixture(size);
    const h = await harness({ size });
    const done = h.sender.start(readerFor(data));

    const s = await joinAs(h);
    await s.nextControl();
    await s.send({ t: 'accept', offset: 0 });

    const indexes = [];
    indexes.push((await s.nextChunk()).index);
    indexes.push((await s.nextChunk()).index);
    await s.send({ t: 'nack', index: 1 });

    let dones = 0;
    while (dones < 2) {
      const frame = await s.next();
      if (frame.kind === 'chunk') indexes.push(frame.value.index);
      else if (frame.value.t === 'done') dones++;
    }
    await s.send({ t: 'complete' });
    await done;

    expect(indexes).toEqual([0, 1, 2, 1, 2]);
    expect(indexes.filter((i) => i === 1)).toHaveLength(2);
  });

  test('a nack storm past the retry limit aborts the transfer', async () => {
    const size = Math.floor(CPS * 2.5);
    const data = fixture(size);
    const h = await harness({ size });
    const done = h.sender.start(readerFor(data));

    const s = await joinAs(h);
    await s.nextControl();
    await s.send({ t: 'accept', offset: 0 });
    await s.nextChunk();

    for (let i = 0; i <= P2PProtocol.NACK_RETRY_LIMIT; i++) await s.send({ t: 'nack', index: 0 });

    await expect(done).rejects.toBeInstanceOf(P2PTransferCorruptedError);
    await tick();
    expect(s.seenControls.some((m) => m.t === 'abort')).toBe(true);
  });

  test('sending pauses while the channel buffer is above the high water mark', async () => {
    const size = CPS * 3;
    const data = fixture(size);
    const h = await harness({ size });
    const done = h.sender.start(readerFor(data));

    const s = await joinAs(h);
    await s.nextControl();

    const senderChannel = s.senderChannel();
    senderChannel.autoDrain = false;
    senderChannel.bufferedAmount = P2PProtocol.BUFFER_HIGH_WATER + 1;
    await s.send({ t: 'accept', offset: 0 });

    await tick(20);
    expect(s.binaryCount).toBe(0);

    senderChannel.drain();
    for (let i = 0; i < 3; i++) expect((await s.nextChunk()).index).toBe(i);
    expect(await s.nextControl()).toEqual({ t: 'done', chunkCount: 3 });
    await s.send({ t: 'complete' });
    await done;
  });

  test('a joiner without the seed is dropped and the session survives', async () => {
    const size = Math.floor(CPS * 2.5);
    const data = fixture(size);
    const h = await harness({ size });
    const done = h.sender.start(readerFor(data));

    const wrongKey = await Crypto.generateKey(Crypto.generateSeed(), 'gcm');
    const bad = await joinAs(h);
    expect((await bad.nextControl()).t).toBe('meta');
    await bad.send({ t: 'accept', offset: 0 }, wrongKey);
    await tick();
    expect(bad.pair.hub.sender.closed).toBe(true);
    bad.signaling.leave();

    const good = await joinAs(h);
    expect((await good.nextControl()).t).toBe('meta');
    await good.send({ t: 'accept', offset: 0 });
    for (let i = 0; i < 3; i++) expect((await good.nextChunk()).index).toBe(i);
    expect(await good.nextControl()).toEqual({ t: 'done', chunkCount: 3 });
    await good.send({ t: 'complete' });
    await done;
  });

  test('an empty file sends no chunks at all', async () => {
    const h = await harness({ size: 0 });
    const done = h.sender.start(readerFor(new Uint8Array(0)));

    const s = await joinAs(h);
    expect(await s.nextControl()).toEqual({
      t: 'meta', name: 'file.bin', size: 0, chunkPayloadSize: CPS,
    });
    await s.send({ t: 'accept', offset: 0 });
    expect(await s.nextControl()).toEqual({ t: 'done', chunkCount: 0 });
    await s.send({ t: 'complete' });
    await done;

    expect(s.binaryCount).toBe(0);
  });

  test('state guards', async () => {
    const h = await harness({ size: 10 });
    expect(() => h.sender.getSessionId()).toThrow('Transfer not started');
    const data = fixture(10);
    const first = h.sender.start(readerFor(data));
    first.catch(() => {});
    await expect(h.sender.start(readerFor(data))).rejects.toThrow('Transfer already started');
    await h.waitingPeer;
    expect(typeof h.sender.getSessionId()).toBe('string');
    await h.sender.cancel();
  });
});
