// This file is generated. Do not modify it manually.

interface FileGetResponse {
  /**
   * An presigned URL to download the file
   */
  url: string;
  /**
   * The size of the file in bytes
   */
  size: number;
  /**
   * The name of the file
   */
  name: string;
  /**
   * When the file will expire, in UNIX timestamp format
   */
  expiresAt: number;
}
export { FileGetResponse };
