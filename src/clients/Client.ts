import axios, { AxiosInstance } from 'axios';
import { ClientOptions } from '../types/sdk/ClientOptions';
import { NotesAPI } from './Notes';
import { SystemAPI } from './System';
import { FilesAPI } from './Files';
import semver from 'semver';

/**
 * @category Client
 */
export class Not3Client {
  private api: AxiosInstance;
  private options: ClientOptions;

  /**
   * The main client class to interact with the Not3 API.
   * @param options The options to configure the client.
   */
  constructor(options: ClientOptions) {
    this.setOptions(options);
  }

  /**
   * Set the options for the client.
   *
   * Remember to not reuse the sub-clients after changing the options.
   *
   * ```ts
   * const client = new Not3Client({ baseUrl: 'https://api.example.com/' });
   * const files = client.files();
   * client.setOptions({ baseUrl: 'https://api.example2.com/' });
   * files.list(); // This will still call the old API
   * ```
   * @param options The options to configure the client.
   */
  setOptions(options: ClientOptions): void {
    this.options = options;
    this.api = axios.create({
      baseURL: options.baseUrl,
      headers: options.password
        ? {
            Authorization: `Bearer ${options.password}`,
          }
        : undefined,
    });
  }

  /**
   * Update the options for the client.
   *
   * This will merge the new options with the existing ones.
   * @param options The options to update the client with.
   * @see {@link setOptions}
   */
  updateOptions(options: Partial<ClientOptions>): void {
    this.setOptions({ ...this.options, ...options });
  }

  /**
   * Get the options for the client.
   * @returns The options of the client.
   */
  getOptions(): ClientOptions {
    return this.options;
  }

  /**
   * Get a sub-client to interact with the notes API.
   * @returns The notes API client.
   */
  notes(): NotesAPI {
    return new NotesAPI(this.api, this.options);
  }

  /**
   * Get a sub-client to interact with the system API.
   * @returns The system API client.
   */
  system(): SystemAPI {
    return new SystemAPI(this.api, this.options);
  }

  /**
   * Get a sub-client to interact with the files API.
   * @returns The files API client.
   */
  files(): FilesAPI {
    return new FilesAPI(this.api, this.options);
  }

  /**
   * Check if the API is compatible with this version of the SDK.
   * @returns Whether the API is compatible.
   */
  async isCompatible(): Promise<boolean> {
    try {
      const info = await this.system().info();
      if (info.version === 'IN-DEV') return true;
      return semver.satisfies(info.version, '>=2.0.0 <3.0.0');
    } catch {
      return false;
    }
  }
}
