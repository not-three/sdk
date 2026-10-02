import { P2PErrorCode } from '../types/sdk/P2P';

/**
 * Base class for all P2P transfer errors.
 * @category Lib
 */
export class P2PError extends Error {
  constructor(
    message: string,
    readonly code: P2PErrorCode,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * The connected server has P2P transfers disabled.
 * @category Lib
 */
export class P2PDisabledError extends P2PError {
  constructor() {
    super('P2P transfers are disabled on this server', 'disabled');
  }
}

/**
 * The requested P2P session does not exist (anymore).
 * @category Lib
 */
export class P2PSessionNotFoundError extends P2PError {
  constructor() {
    super('P2P session not found or expired', 'not-found');
  }
}

/**
 * The requested P2P session already has a receiver attached.
 * @category Lib
 */
export class P2PSessionFullError extends P2PError {
  constructor() {
    super('P2P session already has a receiver', 'session-full');
  }
}

/**
 * The peer could not produce a message decryptable with the seed.
 * @category Lib
 */
export class P2PPeerAuthFailedError extends P2PError {
  constructor() {
    super('Peer failed seed authentication', 'peer-auth-failed');
  }
}

/**
 * The peer went away before the transfer finished.
 * @category Lib
 */
export class P2PPeerDisconnectedError extends P2PError {
  constructor() {
    super('Peer disconnected', 'peer-disconnected');
  }
}

/**
 * The WebRTC connection could not be established in time.
 * @category Lib
 */
export class P2PConnectTimeoutError extends P2PError {
  constructor() {
    super(
      'Could not establish a peer connection (consider configuring a TURN server, or use a storage upload)',
      'connect-timeout',
    );
  }
}

/**
 * A chunk failed validation more often than the retry limit allows.
 * @category Lib
 */
export class P2PTransferCorruptedError extends P2PError {
  constructor() {
    super(
      'Transfer corrupted: chunk retry limit exceeded',
      'transfer-corrupted',
    );
  }
}

/**
 * The transfer was cancelled by one of the peers.
 * @category Lib
 */
export class P2PCancelledError extends P2PError {
  constructor() {
    super('Transfer cancelled', 'cancelled');
  }
}

/**
 * Map a signaling gateway error code to a typed error.
 * @param code The code carried by the gateway's `error` frame.
 * @returns The matching error class, or a generic {@link P2PError}.
 * @category Lib
 */
export function p2pErrorFromGatewayCode(code: string): P2PError {
  switch (code) {
    case 'disabled':
      return new P2PDisabledError();
    case 'not-found':
      return new P2PSessionNotFoundError();
    case 'session-full':
      return new P2PSessionFullError();
    default:
      return new P2PError(`P2P gateway error: ${code}`, code as P2PErrorCode);
  }
}
