export interface ClientOptions {
  /**
   * The base URL of the API with a trailing slash.
   * @example 'https://api.example.com/'
   */
  baseUrl: string;

  /**
   * The instance password of the api. Only required if the API runs in private mode.
   * @example 'password'
   * @default undefined
   */
  password?: string;
}
