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
