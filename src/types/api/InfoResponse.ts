// This file is generated. Do not modify it manually.

interface InfoResponse {
  /**
   * The current version of the API, in semver format or the string "IN-DEV" to indicate a dev build.
   */
  version: string;
  /**
   * The number of tokens the requesting ip has currently remaining
   */
  availableTokens: number;
  /**
   * The maximum number of days that data will be stored before being purged
   */
  maxStorageTimeDays: number;
  /**
   * If the file transfer feature is enabled
   */
  fileTransferEnabled: boolean;
  /**
   * File transfer maximum size in MB
   */
  fileTransferMaxSize: number;
  /**
   * If this instance is running in private mode and requires a password
   */
  privateMode: boolean;
}
export { InfoResponse };
