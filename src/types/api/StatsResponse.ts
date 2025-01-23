// This file is generated. Do not modify it manually.

interface StatsResponse {
  /**
   * The UNIX timestamp of the last time the stats were updated
   */
  time: number;
  /**
   * The total number of notes that have been created and are currently stored in the database
   */
  totalNotes: number;
  /**
   * The amount of request that have been made in the last ~60 seconds
   */
  requestsInLastMinute: number;
  /**
   * The amount of not expired failed requests
   */
  notExpiredFailedRequests: number;
  /**
   * The amount of currently uploaded files
   */
  currentFiles: number;
  /**
   * The amount of files that are not currently being uploaded
   */
  currentUploadingFiles: number;
  /**
   * The amount how many ip addresses are currently banned
   */
  bannedIps: number;
}
export { StatsResponse };
