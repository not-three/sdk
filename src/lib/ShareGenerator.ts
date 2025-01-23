import { ShareOptions } from "../types/sdk/ShareOptions";
import { FragmentData } from "./FragmentData";

/**
 * @category Lib
 */
export class ShareGenerator {
  constructor(private readonly opts: ShareOptions) {}

  /**
   * Generate a link to share a note in the ui.
   */
  noteUi(noteId: string, seed: string, selfDestruct = false): string {
    const fragment = new FragmentData({
      secret: seed,
      server: this.opts.storeServer ? this.opts.apiUrl : undefined,
      selfDestruct: selfDestruct ? true : undefined,
    });
    return `${this.opts.uiUrl}q/${noteId}#${fragment.toString()}`;
  }

  /**
   * Generate a link to share a file in the ui.
   */
  fileUi(fileId: string, seed: string): string {
    const fragment = new FragmentData({
      secret: seed,
      server: this.opts.storeServer ? this.opts.apiUrl : undefined,
    });
    return `${this.opts.uiUrl}f/${fileId}#${fragment.toString()}`;
  }

  // /**
  //  * Generate a command to print a note with curl, using openssl to decrypt it.
  //  */
  // noteCurl(noteId: string, seed: string): string {
  //   return [
  //     `curl ${this.opts.apiUrl}note/${noteId}/raw`,
  //   ].join(' ');
  // }

  // /**
  //  * Generate a command to print a note with curl, using openssl to decrypt it.
  //  */
  // noteCurlSave(noteId: string, seed: string, fileName: string): string {
  //   return this.noteCurl(noteId, seed) + ` > ${fileName}`;
  // }

  /**
  //  * Generate a command to download a file with curl, using openssl to decrypt it.
  //  */
  // fileCurl(fileId: string, seed: string, fileName: string): string {
  //   return [
  //     `curl ${this.opts.apiUrl}file/${fileId}`,
  //   ].join(' ');
  // }

  /**
   * Generate a server side decryption url for a note.
   */
  noteServerSideDecrypt(noteId: string, seed: string): string {
    return `${this.opts.apiUrl}note/${noteId}/decrypt?key=${seed}`;
  }
}
