import { CryptoMode } from './CryptoMode';
import { FragmentData } from '../../lib/FragmentData';

/** Kind of share whose alternatives are requested. */
export type ShareKind = 'note' | 'file' | 'p2p';

/** Identifier for one way to open a share. */
export type ShareAlternativeId =
  'ui' | 'curl' | 'cli' | 'docker' | 'powershell' | 'server-decrypt';

/** Inputs for generating the available ways to open a share. */
export interface ShareTarget {
  /** The kind of share. */
  kind: ShareKind;
  /** Note ID, file ID, or P2P session ID. */
  id: string;
  /** Encryption seed carried by commands and links. */
  seed: string;
  /** Required for files; for notes, selects commands that save to a file. */
  fileName?: string;
  /** Note encryption mode. @default 'cbc' */
  cryptoMode?: CryptoMode;
  /** For notes, use this exact fragment in the browser link. */
  fragment?: FragmentData;
}

/** A copyable way to open a share. */
export interface ShareAlternative {
  /** Stable identifier for this alternative. */
  id: ShareAlternativeId;
  /** Short display label. */
  label: string;
  /** Requirement or security note for this alternative. */
  description: string;
  /** Link or single-line command to copy. */
  value: string;
}
