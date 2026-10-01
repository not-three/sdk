const {
  P2PError, P2PDisabledError, P2PSessionNotFoundError, P2PSessionFullError,
  P2PPeerAuthFailedError, P2PPeerDisconnectedError, P2PConnectTimeoutError,
  P2PTransferCorruptedError, P2PCancelledError, p2pErrorFromGatewayCode,
} = require('../../dist/index.cjs');

describe('P2P errors', () => {
  test('every error carries its stable code and extends P2PError', () => {
    const cases = [
      [new P2PDisabledError(), 'disabled'],
      [new P2PSessionNotFoundError(), 'not-found'],
      [new P2PSessionFullError(), 'session-full'],
      [new P2PPeerAuthFailedError(), 'peer-auth-failed'],
      [new P2PPeerDisconnectedError(), 'peer-disconnected'],
      [new P2PConnectTimeoutError(), 'connect-timeout'],
      [new P2PTransferCorruptedError(), 'transfer-corrupted'],
      [new P2PCancelledError(), 'cancelled'],
    ];
    for (const [err, code] of cases) {
      expect(err).toBeInstanceOf(P2PError);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe(code);
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  test('gateway codes map to the right classes', () => {
    expect(p2pErrorFromGatewayCode('disabled')).toBeInstanceOf(P2PDisabledError);
    expect(p2pErrorFromGatewayCode('not-found')).toBeInstanceOf(P2PSessionNotFoundError);
    expect(p2pErrorFromGatewayCode('session-full')).toBeInstanceOf(P2PSessionFullError);
    const generic = p2pErrorFromGatewayCode('rate-limited');
    expect(generic).toBeInstanceOf(P2PError);
    expect(generic.code).toBe('rate-limited');
  });
});
