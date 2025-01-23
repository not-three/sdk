import { CreateRequest } from '../types/api/CreateRequest';
import { CreateResponse } from '../types/api/CreateResponse';
import { FetchResponse } from '../types/api/FetchResponse';
import { SubClient } from '../lib/SubClient';

/**
 * @category Client
 * @see {@link Not3Client.notes}
 */
export class NotesAPI extends SubClient {
  /**
   * Create a new note.
   * @param req The create request.
   * @throws AxiosError If the request fails.
   * @returns The create response.
   */
  async create(req: CreateRequest): Promise<CreateResponse> {
    const res = await this.api.post('note/json', req);
    return res.data;
  }

  /**
   * Get the note.
   * @param id The note ID.
   * @throws AxiosError If the request fails.
   * @returns The note.
   */
  async get(id: string): Promise<FetchResponse> {
    const res = await this.api.get(`note/${id}/json`);
    return res.data;
  }

  /**
   * Delete a note.
   * @param id The note ID.
   * @param token The deletion token, only required if request is from a different ip address.
   * @throws AxiosError If the request fails.
   */
  async delete(id: string, token?: string): Promise<void> {
    await this.api.delete(`note/${id}`, {
      data: { token },
    });
  }
}
