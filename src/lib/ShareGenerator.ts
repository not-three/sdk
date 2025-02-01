import { ShareOptions } from "../types/sdk/ShareOptions";
import { FragmentData } from "./FragmentData";

/**
 * @category Lib
 */
export class ShareGenerator {
  readonly SCRIPT_URL = 'https://raw.githubusercontent.com/not-three/main/refs/heads/main/scripts/';

  constructor(private readonly opts: ShareOptions) {}

  /**
   * Generate a link to share a note in the ui.
   */
  noteUi(noteId: string, fragment: FragmentData|string): string {
    fragment = typeof fragment === 'string' ? new FragmentData({
      seed: fragment,
      server: this.opts.storeServer ? this.opts.apiUrl : undefined,
    }) : fragment;
    return `${this.opts.uiUrl}q/${noteId}#${fragment.toString()}`;
  }

  /**
   * Generate a link to share a file in the ui.
   */
  fileUi(fileId: string, seed: string): string {
    const fragment = new FragmentData({
      seed: seed,
      server: this.opts.storeServer ? this.opts.apiUrl : undefined,
    });
    return `${this.opts.uiUrl}f/${fileId}#${fragment.toString()}`;
  }

  /**
   * Generate a command to print a note with curl, using openssl to decrypt it.
   */
  noteCurl(noteId: string, seed: string): string {
    return [
      `curl ${this.SCRIPT_URL}decrypt-note.sh`,
      `| bash -s ${this.opts.apiUrl}note/${noteId}/raw ${seed}`,
    ].join(' ');
  }

  /**
   * Generate a command to download a note with curl, using openssl to decrypt it.
   */
  noteCurlSave(noteId: string, seed: string, fileName: string): string {
    return this.noteCurl(noteId, seed) + ` > ${fileName}`;
  }

  /**
   * Generate a command to download a file with curl, using openssl to decrypt it.
   */
  fileCurl(fileId: string, seed: string, fileName: string): string {
    return [
      `curl ${this.SCRIPT_URL}decrypt-file.sh`,
      `| bash -s ${this.opts.apiUrl}file/${fileId} ${seed} ${fileName}`,
    ].join(' ');
  }

  /**
   * Generate a server side decryption url for a note.
   */
  noteServerSideDecrypt(noteId: string, seed: string): string {
    return `${this.opts.apiUrl}note/${noteId}/decrypt?key=${seed}`;
  }
}
