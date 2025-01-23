import { FileGetResponse } from '../types/api/FileGetResponse';
import { FileListResponse } from '../types/api/FileListResponse';
import { SubClient } from '../lib/SubClient';
import axios from 'axios';

/**
 * @category Client
 * @see {@link Not3Client.files}
 */
export class FilesAPI extends SubClient {
  /**
   * Start a new file upload session.
   * @param name The file name.
   * @throws AxiosError If the request fails.
   * @returns The upload ID.
   */
  async startUpload(name: string): Promise<string> {
    const res = await this.api.post('file/upload', { name });
    return res.data.id;
  }

  /**
   * Get the URL to upload a chunk of the file.
   * @param id The upload ID.
   * @param length The length of the chunk.
   * @param part The part number of the chunk.
   * @throws AxiosError If the request fails.
   * @returns The URL to upload the chunk.
   */
  async getUploadChunkURL(
    id: string,
    length: number,
    part?: number,
  ): Promise<string> {
    const res = await this.api.get(`file/upload/${id}`, {
      params: { length, part },
    });
    return res.data.url;
  }

  /**
   * Complete the file upload.
   * @param id The upload ID.
   * @param etags The ETags of the uploaded chunks.
   * @throws AxiosError If the request fails.
   */
  async completeUpload(id: string, etags: string[]): Promise<void> {
    await this.api.put(`file/upload/${id}`, { etags });
  }

  /**
   * Get the file details.
   * @param id The file ID.
   * @throws AxiosError If the request fails.
   * @returns The file details.
   */
  async getFile(id: string): Promise<FileGetResponse> {
    const res = await this.api.get(`file/${id}`, { params: { json: true } });
    return res.data;
  }

  /**
   * Delete a file.
   * @throws AxiosError If the request fails.
   * @param id The file ID.
   */
  async delete(id: string): Promise<void> {
    await this.api.delete(`file/${id}`);
  }

  /**
   * Get a list of files.
   * @throws AxiosError If the request fails.
   * @returns The list of files.
   */
  async getList(): Promise<FileListResponse> {
    const res = await this.api.get('file');
    return res.data;
  }

  /**
   * Upload a file chunk to the server.
   * @param url The URL to upload the chunk to.
   * @param data The chunk data.
   * @throws AxiosError If the request fails.
   * @returns The ETag of the uploaded chunk.
   */
  async uploadChunk(url: string, data: ArrayBuffer): Promise<string> {
    const res = await axios.put(url, data, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    return res.headers.etag.replace(/"/g, '');
  }
}
