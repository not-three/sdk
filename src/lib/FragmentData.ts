import { CryptoMode } from "../types/sdk/CryptoMode";

/**
 * Mainly used by the @not3/ui.
 * As we do not want to send the encryption details to the server,
 * we use this class to store and parse the details from the fragment block of the URL.
 * @category Lib
 */
export class FragmentData {
  /**
   * Parse a fragment from a URL.
   * @param url The URL to parse.
   */
  static fromURL(url: string): FragmentData {
    const fragment = new URL(url).hash.slice(1);
    const params = new URLSearchParams(atob(fragment));
    const seed = params.get('k');
    const server = params.get('s');
    const selfDestruct = params.has('d');
    const cryptoMode = params.get('m') as CryptoMode;
    if (!seed) throw new Error('Seed is required');
    return new FragmentData({ seed, server, selfDestruct, cryptoMode });
  }

  /**
   * The encryption seed.
   */
  readonly seed: string;

  /**
   * The API server to use.
   * @default null
   */
  readonly server: string | null;

  /**
   * Whether the fragment should self-destruct after being read.
   * @default false
   */
  readonly selfDestruct: boolean;

  /**
   * The encryption mode to use.
   * @default 'cbc'
   */
  readonly cryptoMode: CryptoMode;

  /**
   * Create a new fragment.
   * @param options The options to create the fragment.
   */
  constructor(options: {
    seed: string;
    server?: string | null;
    selfDestruct?: boolean;
    cryptoMode?: CryptoMode;
  }) {
    this.seed = options.seed;
    this.server = options.server || null;
    this.selfDestruct = options.selfDestruct || false;
    this.cryptoMode = options.cryptoMode || 'cbc';
  }

  /**
   * Convert the fragment to a URL fragment string.
   * Set this as the hash of the UI URL to share the fragment.
   */
  toString(): string {
    const params = new URLSearchParams();
    params.append('k', this.seed);
    if (this.server) params.append('s', this.server);
    if (this.selfDestruct) params.append('d', '1');
    if (this.cryptoMode !== 'cbc') params.append('m', this.cryptoMode);
    return btoa(params.toString());
  }
}
