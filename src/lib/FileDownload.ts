import { FilesAPI } from "../clients/Files";
import { FileGetResponse } from "../types/api";
import { SetBytesFn } from "../types/sdk/SetBytesFn";
import { CryptoCBC } from "./CryptoCBC";
import { FileUpload } from "./FileUpload";

/**
 * The FileDownload class is a helper to download and decrypt files from the server.
 * @category Lib
 */
export class FileDownload {
  private finished = false;
  private progress = -1;
  private file: FileGetResponse | null = null;

  /**
   * Create a managed FileDownload object.
   * @param api The FilesAPI instance to use
   * @param id The ID of the file to download
   * @param seed The seed to use for decryption
   */
  constructor(
    private readonly api: FilesAPI,
    private readonly id: string,
    private readonly seed: string,
  ) {}

  private errorIfNotPrepared() {
    if (!this.file) throw new Error('Download not prepared');
  }


  /**
   * Get the metadata of the file.
   * @returns The metadata of the file
   */
  getFileMetadata(): FileGetResponse {
    this.errorIfNotPrepared();
    return this.file;
  }

  /**
   * Get the total amount of chunks in the file.
   * @returns The total amount of chunks
   */
  getTotalChunks(): number {
    const meta = this.getFileMetadata();
    return Math.ceil(meta.size / FileUpload.CHUNK_SIZE);
  }

  /**
   * Prepare the download process.
   * @returns A promise that resolves when the download is prepared
   */
  async prepare(): Promise<void> {
    this.file = await this.api.getFile(this.id);
  }

  /**
   * Start the download process.
   * @param setBytes The function to get bytes from the file
   * @returns A promise that resolves when the download is complete
   */
  async start(setBytes: SetBytesFn): Promise<void> {
    this.errorIfNotPrepared();
    const key = await CryptoCBC.generateKey(this.seed);
    const res = await fetch(this.file.url);
    const reader = res.body.getReader();
    let accumulated = new Uint8Array();
    let index = 0;
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const newData = new Uint8Array(accumulated.length + value.length);
      newData.set(accumulated);
      newData.set(value, accumulated.length);
      accumulated = newData;
      while (accumulated.length >= FileUpload.CHUNK_SIZE) {
        const chunk = accumulated.slice(0, FileUpload.CHUNK_SIZE);
        accumulated = accumulated.slice(FileUpload.CHUNK_SIZE);
        const decrypted = await CryptoCBC.decrypt(chunk.buffer, key);
        await setBytes(decrypted, index);
        index++;
        await tick();
      }
      await tick();
    }
    if (accumulated.length) {
      const decrypted = await CryptoCBC.decrypt(accumulated.buffer, key);
      await setBytes(decrypted, index);
    }
  }
}
