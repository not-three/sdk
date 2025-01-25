import { FilesAPI } from "../clients/Files";
import { GetBytesFn } from "../types/sdk/GetBytesFn";
import { FileUploadProgress, FileUploadProgressHook, FileUploadState } from "../types/sdk/Progress";
import { Crypto } from "./Crypto";

/**
 * The FileUpload class is a helper to split files into chunks,
 * encrypt them, and upload them to the server.
 * @category Lib
 */
export class FileUpload {
  /**
   * The size of each chunk to upload.
   * @default 1024 * 1024 * 5
   */
  static readonly CHUNK_SIZE = 1024 * 1024 * 5;

  /**
   * The size of each chunk to upload, minus the AES header size.
   * @default CHUNK_SIZE - Crypto.AES_CBC_HEADER_BYTES
   */
  static readonly ACTUAL_CHUNK_SIZE = FileUpload.CHUNK_SIZE - Crypto.AES_CBC_HEADER_BYTES;

  private progressHook: FileUploadProgressHook | null = null;
  private progress: FileUploadProgress = {};
  private cancelled = false;
  private crashed = false;
  private finished = false;
  private starting = false;
  private id: string | null = null;

  /**
   * Create an managed FileUpload object
   * @param api The FilesAPI instance to use
   * @param name The name of the file being uploaded
   * @param size The size of the file being uploaded in bytes
   * @param parallelUploads The amount of parallel uploads to use, do not set this too high, or you risk getting rate limited
   * @param cancelOnError Should the upload be cancelled if an error occurs?
   * @param seed The seed to use for encryption, if not provided, a random seed will be generated
   */
  constructor(
    private readonly api: FilesAPI,
    private readonly name: string,
    private readonly size: number,
    private readonly parallelUploads = 1,
    private readonly cancelOnError = true,
    private readonly seed = Crypto.generateSeed(),
  ) {}

  private errorIfNotStarted() {
    if (!this.id) throw new Error('Upload not started');
  }

  private errorIfFinished() {
    if (this.finished) throw new Error('Upload already finished');
  }

  private errorIfStarted() {
    if (this.id || this.starting) throw new Error('Upload already started');
  }

  private errorIfCancelled() {
    if (this.cancelled) throw new Error('Upload cancelled');
  }

  /**
   * Get the amount of chunks this file will be split into
   * @returns The amount of chunks
   */
  getChunkCount(): number {
    return Math.ceil(this.size / FileUpload.ACTUAL_CHUNK_SIZE);
  }

  /**
   * Get the size of the file after encryption
   * @returns The size of the file after encryption
   */
  getEncryptedSize(): number {
    return FileUpload.CHUNK_SIZE * this.getChunkCount();
  }

  /**
   * Is the upload finished?
   * @returns True if the upload is finished
   */
  isFinished(): boolean {
    return this.finished;
  }

  /**
   * Is the upload started?
   * @returns True if the upload is started
   */
  isStarted(): boolean {
    return this.id !== null;
  }

  /**
   * Get the file ID
   * @returns The file ID
   */
  getID(): string {
    this.errorIfNotStarted();
    this.errorIfCancelled();
    return this.id!;
  }

  /**
   * Get the seed used for encryption. Needed for decryption.
   * @returns The seed, handle with care.
   */
  getSeed(): string {
    return this.seed;
  }

  /**
   * Set a hook that is called when the progress of the upload changes.
   * @param hook The hook to call
   */
  onProgress(hook: FileUploadProgressHook) {
    this.progressHook = hook;
  }

  /**
   * Get the progress of the upload
   * @returns The progress of the upload
   */
  getProgress(): FileUploadProgress {
    this.errorIfNotStarted();
    this.errorIfCancelled();
    return this.progress;
  }

  private setProgress(id: number, state: FileUploadState, etag?: string): void {
    this.progress[id] = { state, etag };
    if (!this.progressHook) return;
    this.progressHook(this.progress);
  }

  /**
   * Cancel the upload. This action is not immediate,
   * and could take a few moments to complete.
   * The reason behind this is that wee need to wait for
   * the threads to finish their current task, before they
   * check if they should cancel.
   * @returns A promise that resolves when the cancellation request is sent
   */
  async cancel(): Promise<void> {
    this.errorIfNotStarted();
    this.errorIfFinished();
    if (this.cancelled) throw new Error('Upload already cancelled');
    this.cancelled = true;
    await this.api.delete(this.id);
  }

  private async run(getBytes: GetBytesFn) {
    try {
      let current = 0;
      const total = this.getChunkCount();
      const key = await Crypto.generateKey(this.seed);
      let lastError: Error|null = null;
      const worker = async () => {
        let i = -1;
        try {
          while (current < total) {
            if (this.cancelled || this.crashed) break;
            i = current;
            current++;

            const progress = this.progress[i];
            if (progress && progress.state === 'done') continue;

            this.setProgress(i, 'read');
            const start = i * FileUpload.ACTUAL_CHUNK_SIZE;
            const end = Math.min(start + FileUpload.ACTUAL_CHUNK_SIZE, this.size);
            const data = await getBytes(start, end);

            this.setProgress(i, 'crypto');
            if (this.cancelled || this.crashed) break;
            const encrypted = await Crypto.encrypt(data, key);

            this.setProgress(i, 'upload');
            if (this.cancelled || this.crashed) break;
            const url = await this.api.getUploadChunkURL(this.id, encrypted.byteLength, i + 1);
            if (this.cancelled || this.crashed) break;
            const etag = await this.api.uploadChunk(url, encrypted);

            this.setProgress(i, 'done', etag);
          }
        } catch (e) {
          if (i !== -1) this.setProgress(i, 'error');
          this.crashed = true;
          lastError = e;
        }
      }
      await Promise.all(Array.from({ length: this.parallelUploads }, () => worker()));
      if (lastError) throw lastError;
      if (this.cancelled) throw new Error('Upload cancelled');
      if (this.crashed) throw new Error('Upload crashed');
      const sorted = Object.entries(this.progress).sort(([a], [b]) => Number(a) - Number(b));
      const etags = sorted.map(([, { etag }]) => etag);
      if (etags.some(etag => !etag)) throw new Error('Upload incomplete');
      await this.api.completeUpload(this.id, etags);
      this.finished = true;
    } catch (e) {
      if (this.cancelOnError && !this.cancelled) await this.cancel();
      throw e;
    }
  }

  /**
   * Start the upload process.
   * @param getBytes The function to get bytes from the file
   * @returns A promise that resolves when the upload is completed
   */
  async start(getBytes: GetBytesFn): Promise<void> {
    this.errorIfCancelled();
    this.errorIfStarted();
    this.starting = true;
    this.id = await this.api.startUpload(this.name);
    await this.run(getBytes);
  }

  /**
   * If the current upload is crashed, or you want to resume another upload, you can use this method.
   * @param getBytes The function to get bytes from the file
   * @param opt Options for the resume operation
   * @returns A promise that resolves when the upload is completed
   */
  async resume(getBytes: GetBytesFn, opt?: { progress?: FileUploadProgress, id?: string }): Promise<void> {
    this.errorIfCancelled();
    if (!this.crashed) this.errorIfStarted();
    if (opt) {
      if (opt.progress) this.progress = opt.progress;
      if (opt.id) this.id = opt.id;
    }
    if (!this.id) throw new Error('No upload ID provided');
    await this.run(getBytes);
  }
}
