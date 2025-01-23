/**
 * The states of a file upload part.
 * @see {@link FileUpload}
 */
export type FileUploadState = 'done'|'upload'|'crypto'|'read'|'error';

/**
 * A map of the progress of each part of a file upload.
 * @see {@link FileUpload}
 */
export type FileUploadProgress = {
  [part: number]: {
    state: FileUploadState;
    etag?: string;
  };
}

/**
 * A hook that is called when the progress of a file upload changes.
 * @see {@link FileUpload.onProgress}
 */
export type FileUploadProgressHook = (progress: FileUploadProgress) => Promise<void> | void;
