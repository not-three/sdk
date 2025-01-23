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
    const secret = params.get('k');
    const server = params.get('s');
    const selfDestruct = params.has('d');
    if (!secret) throw new Error('Secret is required');
    return new FragmentData({ secret, server, selfDestruct });
  }

  /**
   * The encryption secret.
   */
  readonly secret: string;

  /**
   * The API server to use.
   */
  readonly server: string | null;

  /**
   * Whether the fragment should self-destruct after being read.
   */
  readonly selfDestruct: boolean;

  /**
   * Create a new fragment.
   * @param options The options to create the fragment.
   */
  constructor(options: {
    secret: string;
    server?: string | null;
    selfDestruct?: boolean;
  }) {
    this.secret = options.secret;
    this.server = options.server || null;
    this.selfDestruct = options.selfDestruct || false;
  }

  /**
   * Convert the fragment to a URL fragment string.
   * Set this as the hash of the UI URL to share the fragment.
   */
  toString(): string {
    const params = new URLSearchParams();
    params.append('k', this.secret);
    if (this.server) params.append('s', this.server);
    if (this.selfDestruct) params.append('d', '1');
    return btoa(params.toString());
  }
}
