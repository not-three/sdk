export interface ShareOptions {
  /**
   * The UI URL used to generate share links.
   * With trailing slash.
   * @example 'https://example.com/'
   */
  uiUrl?: string;

  /**
   * The API URL used to generate share links.
   * With trailing slash.
   * @example 'https://api.example.com/'
   */
  apiUrl?: string;

  /**
   * Should the server also be stored in the fragment?
   * Only needed if this API server is different from the default one the UI uses.
   * @default false
   */
  storeServer?: boolean;
}
