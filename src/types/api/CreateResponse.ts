// This file is generated. Do not modify it manually.

interface CreateResponse {
  /**
   * The unique identifier for the note that was created
   */
  id: string;
  /**
   * The token cost of creating the note
   */
  cost: number;
  /**
   * The deletion token for the note, required to delete the note before it expires
   */
  deleteToken: string;
}
export { CreateResponse };
