import { AxiosInstance } from 'axios';
import { ClientOptions } from '../types/sdk/ClientOptions';

/**
 * The base class for all sub-clients.
 * Non operational by itself.
 * @category Lib
 * @see {@link Not3Client}
 */
export class SubClient {
  constructor(
    protected readonly api: AxiosInstance,
    protected readonly options: ClientOptions,
  ) {}
}
