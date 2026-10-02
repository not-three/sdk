const {
  connectPeer,
  P2PSignaling,
  P2PConnectTimeoutError,
} = require('../../dist/index.cjs');
const { createFakeRtcPair, LoopbackSignalingServer } = require('./P2PFakes');

async function pairedSignaling() {
  const server = new LoopbackSignalingServer();
  const WS = server.connectFactory();
  const a = new P2PSignaling('ws://fake/p2p', WS);
  const b = new P2PSignaling('ws://fake/p2p', WS);
  await a.connect();
  await b.connect();
  const { sessionId } = await a.create();
  const joinedPromise = new Promise((r) => {
    a.onPeerJoined = r;
  });
  await b.join(sessionId);
  await joinedPromise;
  return { a, b };
}

describe('connectPeer', () => {
  test('sender and receiver end with linked open channels', async () => {
    const { a, b } = await pairedSignaling();
    const { senderFactory, receiverFactory } = createFakeRtcPair();
    const [s, r] = await Promise.all([
      connectPeer({
        role: 'sender',
        signaling: a,
        rtc: senderFactory,
        iceServers: [],
      }),
      connectPeer({
        role: 'receiver',
        signaling: b,
        rtc: receiverFactory,
        iceServers: [],
      }),
    ]);
    expect(s.maxMessageSize).toBe(262144);
    // prove the channels are cross-linked
    const got = new Promise((res) => {
      r.channel.onmessage = (ev) => res(ev.data);
    });
    s.channel.send('hello');
    await expect(got).resolves.toBe('hello');
  });

  test('buffers a candidate until the remote SDP is installed', async () => {
    const { a, b } = await pairedSignaling();
    const { senderFactory, receiverFactory } = createFakeRtcPair();
    const added = [];
    const strictReceiver = (config) => {
      const pc = receiverFactory(config);
      const setRemote = pc.setRemoteDescription.bind(pc);
      const addCandidate = pc.addIceCandidate.bind(pc);
      pc.setRemoteDescription = async (description) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return setRemote(description);
      };
      pc.addIceCandidate = async (candidate) => {
        if (!pc.remoteDescription)
          throw new Error('candidate before remote description');
        added.push(candidate);
        return addCandidate(candidate);
      };
      return pc;
    };

    const outcomes = await Promise.allSettled([
      connectPeer({
        role: 'sender',
        signaling: a,
        rtc: senderFactory,
        iceServers: [],
        timeoutMs: 100,
      }),
      connectPeer({
        role: 'receiver',
        signaling: b,
        rtc: strictReceiver,
        iceServers: [],
        timeoutMs: 100,
      }),
    ]);
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') outcome.value.pc.close();
    }
    a.leave();
    b.leave();

    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    expect(added).toHaveLength(1);
  });

  test('times out with P2PConnectTimeoutError when the peer never answers', async () => {
    const { a } = await pairedSignaling();
    const { senderFactory } = createFakeRtcPair();
    await expect(
      connectPeer({
        role: 'sender',
        signaling: a,
        rtc: senderFactory,
        iceServers: [],
        timeoutMs: 30,
      }),
    ).rejects.toBeInstanceOf(P2PConnectTimeoutError);
  });
});
