// This file is generated. Do not modify it manually.

interface CreateRequest {
  /**
   * The content of the note, encrypted by the client
   */
  content: string;
  /**
   * When the note should expire, in seconds from the current time.
   */
  expiresIn: number;
  /**
   * The MIME type of the content
   */
  mime?: string;
  /**
   * Whether the note should be deleted after being fetched once
   */
  selfDestruct: boolean;
}
export { CreateRequest };
