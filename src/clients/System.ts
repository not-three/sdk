import { InfoResponse } from '../types/api/InfoResponse';
import { StatsResponse } from '../types/api/StatsResponse';
import { SubClient } from '../lib/SubClient';

/**
 * @category Client
 * @see {@link Not3Client.system}
 */
export class SystemAPI extends SubClient {
  private infoCache: InfoResponse | null = null;

  /**
   * Get system base information.
   * @throws AxiosError If the request fails.
   * @returns The system information.
   */
  async info(): Promise<InfoResponse> {
    if (this.infoCache) return this.infoCache;
    const res = await this.api.get('info');
    this.infoCache = res.data;
    return res.data;
  }

  /**
   * Get system statistics.
   * @param password The password for the stats, if required.
   * @throws AxiosError If the request fails.
   * @returns The system statistics.
   */
  async stats(password?: string): Promise<StatsResponse> {
    const res = await this.api.get('stats', {
      params: { password },
    });
    return res.data;
  }
}
