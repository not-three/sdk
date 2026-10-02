# not-th.re/sdk

[![SDK Documentation](https://img.shields.io/badge/SDK-Documentation-5c6ac4?style=for-the-badge)](https://sdk.not-th.re)
[![OpenAPI Documentation](https://img.shields.io/badge/OpenAPI-Documentation-5c6ac4?style=for-the-badge)](https://api.not-th.re)

Please visit the [main](https://github.com/not-three/main) repository for more information.

The sdk documentation also has a nightly variant:
[https://sdk.not-th.re/nightly](https://sdk.not-th.re/nightly)

## P2P transfers

Files of unlimited size can be streamed directly between two peers over a
WebRTC data channel, end-to-end encrypted, without ever touching server
storage — the API only relays the signaling handshake. Use `P2PSender` to
create a session (share the link built by `ShareGenerator.p2pUi`) and
`P2PReceiver` to join it. Both stream: memory stays bounded no matter how
large the file is, transfers resume after a dropped connection, and every
chunk is validated on arrival. `Not3Client.p2p()` reports whether the
connected server has the feature enabled.

In a browser, pass a selected `File` to a sender. Share its session ID and
seed with the receiver after the session reaches `waiting-peer`:

```ts
import { Not3Client, P2PSender } from '@not3/sdk';

const client = new Not3Client({ baseUrl: 'https://api.example.com/' });
const sender = new P2PSender(client.p2p(), file.name, file.size);
sender.onProgress(({ state }) => {
  if (state === 'waiting-peer') {
    console.log(sender.getSessionId(), sender.getSeed());
  }
});
await sender.start((start, end) => file.slice(start, end).arrayBuffer());
```

Receivers normally accept after decrypting the file metadata. To ask for
consent first, pass `manualAccept: true`: `getMeta()` resolves before any accept
frame or file chunk is processed. Call `accept()` to start streaming, or
`reject()` to tell the sender the transfer was cancelled.

```ts
import { P2PReceiver } from '@not3/sdk';

const receiver = new P2PReceiver(client.p2p(), sessionId, seed);
const receiving = receiver.start(writeChunk, { manualAccept: true });
const meta = await receiver.getMeta();
if (await confirmReceive(meta)) await receiver.accept();
else await receiver.reject();
await receiving;
```

Calling `P2PSender.cancel()` during a transfer flushes its encrypted abort
before closing the channel, so the receiver can report cancellation.

The SDK uses the standard `WebSocket` and `RTCPeerConnection` APIs without
adding runtime dependencies. In Node, inject implementations of both APIs
from your chosen libraries:

```ts
import { Not3Client } from '@not3/sdk';

const client = new Not3Client({
  baseUrl: 'https://api.example.com/',
  rtc: (config) => new NodeRTCPeerConnection(config),
  webSocket: NodeWebSocket,
});
```

## P2P rooms

`P2PRoom` is a generic encrypted WebRTC mesh for small live messages. The
gateway handles room membership and directed signaling; it cannot read data
channel messages. Your application chooses the message format and shares the
room ID and seed with invitees. Check `client.p2p().roomsEnabled()` before
offering room creation.

```ts
import { Crypto, Not3Client } from '@not3/sdk';

const client = new Not3Client({ baseUrl: 'https://api.example.com/' });
const seed = Crypto.generateSeed();
const room = client.p2p().room({
  seed,
  onSignalingLost: () => showConnectionWarning(),
});
room.onMessage = (peerId, data) => handleMessage(peerId, data);
room.onPeerJoined = (peerId) => console.log('Connected:', peerId);
room.onPeerLeft = (peerId) => console.log('Disconnected:', peerId);
room.onClose = (error) => console.log('Room closed:', error);
const { roomId } = await room.create();
await room.broadcast(new Uint8Array([1, 2, 3]));
// An invitee uses client.p2p().room({ seed }).join(roomId).
```

`join()` resolves on the gateway acknowledgment; `onPeerJoined` fires when a
data channel opens. `send(peerId, data)` addresses one connected member and
`broadcast(data)` sends to all connected members. Both accept strings,
`Uint8Array`, and `ArrayBuffer`; the receiver gets the decrypted string or
`ArrayBuffer`. Call `leave()` to close the room.

If signaling closes while peer channels remain open, `onSignalingLost` fires
once and those channels keep carrying messages. New peers cannot join that
mesh. `onClose` does not fire at that point; it fires once after `leave()` or
when the last live channel closes. If signaling closes with no live channels,
only `onClose` fires.

In Node, use the same injected `rtc` and `webSocket` implementations shown in
the transfer example above, then call `client.p2p().room({ seed })`.
