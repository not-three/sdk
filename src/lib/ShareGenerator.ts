import { ShareOptions } from '../types/sdk/ShareOptions';
import { CryptoMode } from '../types/sdk/CryptoMode';
import { ShareAlternative, ShareTarget } from '../types/sdk/ShareAlternative';
import { FragmentData } from './FragmentData';

function quote(value: string, shell: 'bash' | 'powershell'): string {
  const escaped =
    shell === 'bash' ? value.replace(/'/g, "'\\''") : value.replace(/'/g, "''");
  return `'${escaped}'`;
}

/**
 * @category Lib
 */
export class ShareGenerator {
  readonly SCRIPT_URL =
    'https://raw.githubusercontent.com/not-three/main/refs/heads/main/scripts/';

  constructor(private readonly opts: ShareOptions) {}

  /**
   * Generate a link to share a note in the ui.
   */
  noteUi(noteId: string, fragment: FragmentData | string): string {
    fragment =
      typeof fragment === 'string'
        ? new FragmentData({
            seed: fragment,
            server: this.opts.storeServer ? this.opts.apiUrl : undefined,
          })
        : fragment;
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
   * Generate a link to receive a live P2P transfer in the ui.
   */
  p2pUi(sessionId: string, seed: string): string {
    const fragment = new FragmentData({
      seed,
      server: this.opts.storeServer ? this.opts.apiUrl : undefined,
      cryptoMode: 'gcm',
      p2p: true,
    });
    return `${this.opts.uiUrl}f/${sessionId}#${fragment.toString()}`;
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
    return `${this.opts.apiUrl}note/${noteId}/decrypt?key=${encodeURIComponent(seed)}`;
  }

  /** Build a CLI command that prints a note. */
  noteCli(
    noteId: string,
    seed: string,
    cryptoMode: CryptoMode = 'cbc',
  ): string {
    return (
      `not3 note get ${noteId} --seed ${quote(seed, 'bash')}` +
      (this.opts.storeServer
        ? ` --server ${this.opts.apiUrl?.replace(/\/$/, '')}`
        : '') +
      (cryptoMode === 'gcm' ? ' --mode gcm' : '')
    );
  }

  /** Build a CLI command that saves a note to a file. */
  noteCliSave(
    noteId: string,
    seed: string,
    fileName: string,
    cryptoMode: CryptoMode = 'cbc',
  ): string {
    return `${this.noteCli(noteId, seed, cryptoMode)} --output ${quote(fileName, 'bash')}`;
  }

  /** Build a CLI command that downloads a file. */
  fileCli(fileId: string, seed: string, fileName: string): string {
    return (
      `not3 file download ${fileId} ${quote(fileName, 'bash')} --seed ${quote(seed, 'bash')}` +
      (this.opts.storeServer
        ? ` --server ${this.opts.apiUrl?.replace(/\/$/, '')}`
        : '')
    );
  }

  /** Build a CLI command that receives a live P2P transfer. */
  p2pCli(sessionId: string, seed: string): string {
    return `not3 p2p receive ${quote(this.p2pUi(sessionId, seed), 'bash')}`;
  }

  private dockerCommand(cliCommand: string): string {
    return `docker run --rm -it -v "$(pwd):/data" ${this.opts.cliImage || 'ghcr.io/not-three/cli'} ${cliCommand.slice(5)}`;
  }

  /** Build a Docker command that prints a note. */
  noteDocker(
    noteId: string,
    seed: string,
    cryptoMode: CryptoMode = 'cbc',
  ): string {
    return this.dockerCommand(this.noteCli(noteId, seed, cryptoMode));
  }

  /** Build a Docker command that saves a note to the current directory. */
  noteDockerSave(
    noteId: string,
    seed: string,
    fileName: string,
    cryptoMode: CryptoMode = 'cbc',
  ): string {
    return this.dockerCommand(
      this.noteCliSave(noteId, seed, fileName, cryptoMode),
    );
  }

  /** Build a Docker command that downloads a file to the current directory. */
  fileDocker(fileId: string, seed: string, fileName: string): string {
    return this.dockerCommand(this.fileCli(fileId, seed, fileName));
  }

  /** Build a Docker command that receives a live P2P transfer. */
  p2pDocker(sessionId: string, seed: string): string {
    return this.dockerCommand(this.p2pCli(sessionId, seed));
  }

  /** Build a PowerShell command that prints a note. */
  notePowerShell(noteId: string, seed: string): string {
    return (
      `& ([scriptblock]::Create((irm ${this.opts.scriptBaseUrl || this.SCRIPT_URL}decrypt-note.ps1))) ` +
      `${quote(`${this.opts.apiUrl}note/${noteId}/raw`, 'powershell')} ${quote(seed, 'powershell')}`
    );
  }

  /** Build a PowerShell command that saves a note to a file. */
  notePowerShellSave(noteId: string, seed: string, fileName: string): string {
    return `${this.notePowerShell(noteId, seed)} > ${quote(fileName, 'powershell')}`;
  }

  /** Build a PowerShell command that downloads a file. */
  filePowerShell(fileId: string, seed: string, fileName: string): string {
    return (
      `& ([scriptblock]::Create((irm ${this.opts.scriptBaseUrl || this.SCRIPT_URL}decrypt-file.ps1))) ` +
      `${quote(`${this.opts.apiUrl}file/${fileId}`, 'powershell')} ${quote(seed, 'powershell')} ${quote(fileName, 'powershell')}`
    );
  }

  /** List the supported links and commands for opening a share in display order. */
  alternatives(target: ShareTarget): ShareAlternative[] {
    const { id, seed, fileName } = target;
    const cliDescription = 'Needs the not3 CLI (npm i -g @not3/cli).';
    const dockerDescription =
      'Needs Docker, writes into the current directory.';
    const curlDescription = 'Needs curl, openssl, base64, xxd, head and tail.';
    const powershellDescription =
      'Windows PowerShell 5.1 or PowerShell 7, no extra tools.';

    if (target.kind === 'p2p') {
      return [
        {
          id: 'ui',
          label: 'Link',
          description: 'Open this link in a browser.',
          value: this.p2pUi(id, seed),
        },
        {
          id: 'cli',
          label: 'CLI',
          description: cliDescription,
          value: this.p2pCli(id, seed),
        },
        {
          id: 'docker',
          label: 'Docker',
          description: dockerDescription,
          value: this.p2pDocker(id, seed),
        },
      ];
    }

    if (target.kind === 'file') {
      return [
        {
          id: 'ui',
          label: 'Link',
          description: 'Open this link in a browser.',
          value: this.fileUi(id, seed),
        },
        {
          id: 'cli',
          label: 'CLI',
          description: cliDescription,
          value: this.fileCli(id, seed, fileName!),
        },
        {
          id: 'docker',
          label: 'Docker',
          description: dockerDescription,
          value: this.fileDocker(id, seed, fileName!),
        },
        {
          id: 'curl',
          label: 'cURL',
          description: curlDescription,
          value: this.fileCurl(id, seed, fileName!),
        },
        {
          id: 'powershell',
          label: 'PowerShell',
          description: powershellDescription,
          value: this.filePowerShell(id, seed, fileName!),
        },
      ];
    }

    const cryptoMode = target.cryptoMode || 'cbc';
    const alternatives: ShareAlternative[] = [
      {
        id: 'ui',
        label: 'Link',
        description: 'Open this link in a browser.',
        value: this.noteUi(id, target.fragment || seed),
      },
      {
        id: 'cli',
        label: 'CLI',
        description: cliDescription,
        value: fileName
          ? this.noteCliSave(id, seed, fileName, cryptoMode)
          : this.noteCli(id, seed, cryptoMode),
      },
      {
        id: 'docker',
        label: 'Docker',
        description: dockerDescription,
        value: fileName
          ? this.noteDockerSave(id, seed, fileName, cryptoMode)
          : this.noteDocker(id, seed, cryptoMode),
      },
    ];

    if (cryptoMode === 'cbc') {
      alternatives.push(
        {
          id: 'curl',
          label: 'cURL',
          description: curlDescription,
          value: fileName
            ? this.noteCurlSave(id, seed, fileName)
            : this.noteCurl(id, seed),
        },
        {
          id: 'powershell',
          label: 'PowerShell',
          description: powershellDescription,
          value: fileName
            ? this.notePowerShellSave(id, seed, fileName)
            : this.notePowerShell(id, seed),
        },
        {
          id: 'server-decrypt',
          label: 'Server-side decrypt',
          description: 'Decrypt on the server; the server sees the key.',
          value: this.noteServerSideDecrypt(id, seed),
        },
      );
    }
    return alternatives;
  }
}
