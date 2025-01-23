/**
 * Function used by the {@link FileDownload} to write bytes to a file.
 * @param buf The buffer to write
 * @param index The current part index, starting at 0
 */
export type SetBytesFn = (buf: ArrayBuffer, index: number) => Promise<void>;
