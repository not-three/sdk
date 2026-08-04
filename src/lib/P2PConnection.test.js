const { connectPeer, P2PSignaling, P2PConnectTimeoutError } = require('../../dist/index.cjs');
const { createFakeRtcPair, LoopbackSignalingServer } = require('./P2PFakes');

async function pairedSignaling() {
  const server = new LoopbackSignalingServer();
  const WS = server.connectFactory();
  const a = new P2PSignaling('ws://fake/p2p', WS);
  const b = new P2PSignaling('ws://fake/p2p', WS);
  await a.connect(); await b.connect();
  const { sessionId } = await a.create();
  const joinedPromise = new Promise(r => { a.onPeerJoined = r; });
  await b.join(sessionId);
  await joinedPromise;
  return { a, b };
}

describe('connectPeer', () => {
  test('sender and receiver end with linked open channels', async () => {
    const { a, b } = await pairedSignaling();
    const { senderFactory, receiverFactory } = createFakeRtcPair();
    const [s, r] = await Promise.all([
      connectPeer({ role: 'sender', signaling: a, rtc: senderFactory, iceServers: [] }),
      connectPeer({ role: 'receiver', signaling: b, rtc: receiverFactory, iceServers: [] }),
    ]);
    expect(s.maxMessageSize).toBe(262144);
    // prove the channels are cross-linked
    const got = new Promise(res => { r.channel.onmessage = (ev) => res(ev.data); });
    s.channel.send('hello');
    await expect(got).resolves.toBe('hello');
  });

  test('times out with P2PConnectTimeoutError when the peer never answers', async () => {
    const { a } = await pairedSignaling();
    const { senderFactory } = createFakeRtcPair();
    await expect(
      connectPeer({ role: 'sender', signaling: a, rtc: senderFactory, iceServers: [], timeoutMs: 30 })
    ).rejects.toBeInstanceOf(P2PConnectTimeoutError);
  });
});
