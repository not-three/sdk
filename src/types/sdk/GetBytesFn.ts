/**
 * Function used by the {@link FileUpload} to get bytes from a file.
 * @param start The start byte index
 * @param end The end byte index
 * @returns The bytes from the file as a buffer
 */
export type GetBytesFn = (start: number, end: number) => Promise<ArrayBuffer>;
