const {
  Not3Client, P2PSender, P2PReceiver, P2PProtocol, Crypto,
  P2PCancelledError, P2PPeerAuthFailedError,
} = require('../../dist/index.cjs');
const { LoopbackSignalingServer, createFakeRtcPair } = require('./P2PFakes');

jest.setTimeout(10000);

const MAX_MESSAGE_SIZE = 65536;
const CPS = P2PProtocol.chunkPayloadSize(MAX_MESSAGE_SIZE);

function randomBytes(size) {
  const u = new Uint8Array(size);
  for (let o = 0; o < size; o += 65536) {
    crypto.getRandomValues(u.subarray(o, Math.min(o + 65536, size)));
  }
  return u;
}

/**
 * A pair of `RTCFactory`s that hand out the two halves of the same fake link,
 * whichever side asks first.
 */
function linkedRtc(maxMessageSize = MAX_MESSAGE_SIZE) {
  const pairs = [];
  let pending = null;
  const half = (role) => (config) => {
    let pair = pending;
    if (pair) {
      pending = null;
    } else {
      pair = createFakeRtcPair({ maxMessageSize });
      pairs.push(pair);
      pending = pair;
    }
    return role === 'sender' ? pair.senderFactory(config) : pair.receiverFactory(config);
  };
  return { pairs, senderRtc: half('sender'), receiverRtc: half('receiver') };
}

/** Record every progress update and let tests await a specific state. */
function record(transfer) {
  const states = [];
  const bytes = [];
  const waiters = [];
  transfer.onProgress((p) => {
    states.push(p.state);
    bytes.push(p.bytesTransferred);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].state === p.state) waiters.splice(i, 1)[0].resolve();
    }
  });
  return {
    states,
    bytes,
    waitFor: (state) =>
      states.includes(state)
        ? Promise.resolve()
        : new Promise((resolve) => waiters.push({ state, resolve })),
  };
}

function setup(maxMessageSize = MAX_MESSAGE_SIZE) {
  const server = new LoopbackSignalingServer();
  const WS = server.connectFactory();
  const rtc = linkedRtc(maxMessageSize);
  const opts = { baseUrl: 'https://api.x/', webSocket: WS };
  return {
    rtc,
    senderP2P: new Not3Client({ ...opts, rtc: rtc.senderRtc }).p2p(),
    receiverP2P: new Not3Client({ ...opts, rtc: rtc.receiverRtc }).p2p(),
  };
}

const readerFor = (data) => async (start, end) => data.slice(start, end).buffer;

/** The sender's end of the most recently created fake link. */
const senderChannel = (rtc) => rtc.pairs[rtc.pairs.length - 1].hub.sender._localChannel;

describe('P2P loopback', () => {
  test('transfers a 1 MiB file byte-identically', async () => {
    const size = 1024 * 1024;
    const data = randomBytes(size);
    const { rtc, senderP2P, receiverP2P } = setup();

    const sender = new P2PSender(senderP2P, 'big.bin', size);
    const senderProgress = record(sender);
    const sendDone = sender.start(readerFor(data));
    await senderProgress.waitFor('waiting-peer');

    const receiver = new P2PReceiver(receiverP2P, sender.getSessionId(), sender.getSeed());
    const receiverProgress = record(receiver);
    const out = [];
    const recvDone = receiver.start(async (buf) => { out.push(Buffer.from(new Uint8Array(buf))); });

    await Promise.all([sendDone, recvDone]);

    expect(Buffer.compare(Buffer.concat(out), Buffer.from(data))).toBe(0);
    expect(await receiver.getMeta()).toEqual({ name: 'big.bin', size, chunkPayloadSize: CPS });
    expect(sender.getProgress().state).toBe('done');
    expect(receiver.getProgress().state).toBe('done');
    for (const p of [senderProgress, receiverProgress]) {
      expect(p.states[p.states.length - 1]).toBe('done');
      expect(p.bytes.every((v, i) => i === 0 || v >= p.bytes[i - 1])).toBe(true);
    }
    expect(rtc.pairs).toHaveLength(1);
  });

  test('a killed channel is resumed by a re-joining receiver', async () => {
    const size = CPS * 8;
    const data = randomBytes(size);
    const { rtc, senderP2P, receiverP2P } = setup();

    const sender = new P2PSender(senderP2P, 'resume.bin', size);
    const senderProgress = record(sender);
    const sendDone = sender.start(readerFor(data));
    let sendSettled = false;
    sendDone.then(() => { sendSettled = true; }, () => { sendSettled = true; });
    await senderProgress.waitFor('waiting-peer');

    const first = new P2PReceiver(receiverP2P, sender.getSessionId(), sender.getSeed());
    const out1 = [];
    let written = 0;
    const firstDone = first.start(async (buf) => {
      out1.push(Buffer.from(new Uint8Array(buf)));
      written += buf.byteLength;
      // Kill the link once a couple of chunks are safely stored.
      if (out1.length === 3) senderChannel(rtc).close();
    });
    await expect(firstDone).rejects.toBeDefined();
    expect(sendSettled).toBe(false);

    const offset = Math.floor(written / CPS) * CPS;
    const second = new P2PReceiver(receiverP2P, sender.getSessionId(), sender.getSeed());
    const out2 = [];
    const indexes = [];
    await second.start(async (buf, index) => {
      out2.push(Buffer.from(new Uint8Array(buf)));
      indexes.push(index);
    }, written);
    await sendDone;

    expect(indexes[0]).toBe(offset / CPS);
    const combined = Buffer.concat([
      Buffer.concat(out1).subarray(0, offset),
      Buffer.concat(out2),
    ]);
    expect(Buffer.compare(combined, Buffer.from(data))).toBe(0);
    expect(rtc.pairs.length).toBeGreaterThanOrEqual(2);
  });

  test('a full restart with the original seed resumes the file', async () => {
    const size = CPS * 6;
    const data = randomBytes(size);
    const { rtc, senderP2P, receiverP2P } = setup();

    const first = new P2PSender(senderP2P, 'restart.bin', size);
    const firstProgress = record(first);
    const firstSend = first.start(readerFor(data));
    firstSend.catch(() => {});
    await firstProgress.waitFor('waiting-peer');

    const firstReceiver = new P2PReceiver(receiverP2P, first.getSessionId(), first.getSeed());
    const out1 = [];
    let written = 0;
    const firstRecv = firstReceiver.start(async (buf) => {
      out1.push(Buffer.from(new Uint8Array(buf)));
      written += buf.byteLength;
      if (out1.length === 2) await first.cancel();
    });
    await expect(firstRecv).rejects.toBeInstanceOf(P2PCancelledError);
    await expect(firstSend).rejects.toBeInstanceOf(P2PCancelledError);

    // Fresh session, same seed: the receiver can continue where it stopped.
    const second = new P2PSender(senderP2P, 'restart.bin', size, { seed: first.getSeed() });
    expect(second.getSeed()).toBe(first.getSeed());
    const secondProgress = record(second);
    const secondSend = second.start(readerFor(data));
    await secondProgress.waitFor('waiting-peer');
    expect(second.getSessionId()).not.toBe(first.getSessionId());

    const offset = Math.floor(written / CPS) * CPS;
    const secondReceiver = new P2PReceiver(receiverP2P, second.getSessionId(), second.getSeed());
    const out2 = [];
    await secondReceiver.start(async (buf) => { out2.push(Buffer.from(new Uint8Array(buf))); }, written);
    await secondSend;

    const combined = Buffer.concat([
      Buffer.concat(out1).subarray(0, offset),
      Buffer.concat(out2),
    ]);
    expect(Buffer.compare(combined, Buffer.from(data))).toBe(0);
    expect(rtc.pairs.length).toBeGreaterThanOrEqual(2);
  });

  test('a corrupted chunk costs one nack round-trip and nothing else', async () => {
    const size = CPS * 4;
    const data = randomBytes(size);
    const { rtc, senderP2P, receiverP2P } = setup();

    // Corrupt the very first binary frame the sender puts on the wire.
    const p2p = senderP2P;
    const rtcFactory = p2p.rtcFactory();
    p2p.rtcFactory = () => (config) => {
      const pc = rtcFactory(config);
      const create = pc.createDataChannel.bind(pc);
      pc.createDataChannel = (...args) => {
        const channel = create(...args);
        channel.corruptNext((bytes) => { bytes[bytes.length - 1] ^= 0xff; });
        return channel;
      };
      return pc;
    };

    const sender = new P2PSender(p2p, 'corrupt.bin', size);
    const progress = record(sender);
    const sendDone = sender.start(readerFor(data));
    await progress.waitFor('waiting-peer');

    const receiver = new P2PReceiver(receiverP2P, sender.getSessionId(), sender.getSeed());
    const out = [];
    const indexes = [];
    const recvDone = receiver.start(async (buf, index) => {
      out.push(Buffer.from(new Uint8Array(buf)));
      indexes.push(index);
    });
    await Promise.all([sendDone, recvDone]);

    // Each chunk reaches the sink exactly once and in order, despite the nack.
    expect(indexes).toEqual([0, 1, 2, 3]);
    expect(Buffer.compare(Buffer.concat(out), Buffer.from(data))).toBe(0);
    // Go-back-N: the rewind re-sends from the nacked index, so the chunks that
    // were already in flight are sent twice — but never more than one rewind.
    const binaryFrames = senderChannel(rtc).sent.filter((d) => typeof d !== 'string');
    expect(binaryFrames.length).toBeGreaterThan(4);
    expect(binaryFrames.length).toBeLessThanOrEqual(8);
  });

  test('a receiver with the wrong seed does not spoil the session', async () => {
    const size = CPS * 3;
    const data = randomBytes(size);
    const { senderP2P, receiverP2P } = setup();

    const sender = new P2PSender(senderP2P, 'guarded.bin', size);
    const progress = record(sender);
    const sendDone = sender.start(readerFor(data));
    await progress.waitFor('waiting-peer');

    const impostor = new P2PReceiver(receiverP2P, sender.getSessionId(), Crypto.generateSeed());
    await expect(impostor.start(async () => {})).rejects.toBeInstanceOf(P2PPeerAuthFailedError);

    const receiver = new P2PReceiver(receiverP2P, sender.getSessionId(), sender.getSeed());
    const out = [];
    await Promise.all([
      sendDone,
      receiver.start(async (buf) => { out.push(Buffer.from(new Uint8Array(buf))); }),
    ]);
    expect(Buffer.compare(Buffer.concat(out), Buffer.from(data))).toBe(0);
  });

  test('cancelling from the sender ends both sides', async () => {
    const size = CPS * 8;
    const data = randomBytes(size);
    const { senderP2P, receiverP2P } = setup();

    const sender = new P2PSender(senderP2P, 'cancel.bin', size);
    const progress = record(sender);
    const sendDone = sender.start(readerFor(data));
    sendDone.catch(() => {});
    await progress.waitFor('waiting-peer');

    const receiver = new P2PReceiver(receiverP2P, sender.getSessionId(), sender.getSeed());
    const recvDone = receiver.start(async (buf, index) => {
      if (index === 0) await sender.cancel();
    });

    await expect(recvDone).rejects.toBeInstanceOf(P2PCancelledError);
    await expect(sendDone).rejects.toBeInstanceOf(P2PCancelledError);
  });

  test('cancelling from the receiver ends both sides', async () => {
    const size = CPS * 8;
    const data = randomBytes(size);
    const { senderP2P, receiverP2P } = setup();

    const sender = new P2PSender(senderP2P, 'cancel.bin', size);
    const progress = record(sender);
    const sendDone = sender.start(readerFor(data));
    sendDone.catch(() => {});
    await progress.waitFor('waiting-peer');

    const receiver = new P2PReceiver(receiverP2P, sender.getSessionId(), sender.getSeed());
    const recvDone = receiver.start(async (buf, index) => {
      if (index === 0) await receiver.cancel();
    });

    await expect(recvDone).rejects.toBeInstanceOf(P2PCancelledError);
    await expect(sendDone).rejects.toBeInstanceOf(P2PCancelledError);
  });
});
