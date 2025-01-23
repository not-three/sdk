// This file is generated. Do not modify it manually.

interface FetchResponse {
  /**
   * The content of the note, encrypted by the client
   */
  content: string;
  /**
   * When the note will expire, in UNIX timestamp format
   */
  expiresAt: number;
  /**
   * The MIME type of the content
   */
  mime?: string;
  /**
   * Whether the note was deleted after being fetched
   */
  deleted: boolean;
}
export { FetchResponse };
