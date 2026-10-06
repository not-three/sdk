const { ShareGenerator, FragmentData } = require('../../dist/index.cjs');

describe('ShareGenerator', () => {
  const opts = {
    uiUrl: 'https://ui.example.com/',
    apiUrl: 'https://api.example.com/',
  };
  const gen = new ShareGenerator(opts);

  describe('noteUi', () => {
    test('builds a note UI link from a seed string', () => {
      const url = gen.noteUi('note1', 'seed123');
      expect(url.startsWith('https://ui.example.com/q/note1#')).toBe(true);
      const fragment = FragmentData.fromURL(url);
      expect(fragment.seed).toBe('seed123');
      // storeServer defaults to false -> server not embedded.
      expect(fragment.server).toBeNull();
    });

    test('accepts a FragmentData instance directly', () => {
      const frag = new FragmentData({ seed: 'seedX', cryptoMode: 'gcm' });
      const url = gen.noteUi('note2', frag);
      const parsed = FragmentData.fromURL(url);
      expect(parsed.seed).toBe('seedX');
      expect(parsed.cryptoMode).toBe('gcm');
    });

    test('embeds the API server when storeServer is enabled', () => {
      const genStore = new ShareGenerator({ ...opts, storeServer: true });
      const url = genStore.noteUi('note3', 'seedY');
      expect(FragmentData.fromURL(url).server).toBe(opts.apiUrl);
    });
  });

  describe('fileUi', () => {
    test('builds a file UI link', () => {
      const url = gen.fileUi('file1', 'seedF');
      expect(url.startsWith('https://ui.example.com/f/file1#')).toBe(true);
      expect(FragmentData.fromURL(url).seed).toBe('seedF');
    });

    test('embeds the API server when storeServer is enabled', () => {
      const genStore = new ShareGenerator({ ...opts, storeServer: true });
      const url = genStore.fileUi('file2', 'seedF2');
      expect(FragmentData.fromURL(url).server).toBe(opts.apiUrl);
    });
  });

  describe('curl commands', () => {
    test('noteCurl targets the raw note endpoint', () => {
      const cmd = gen.noteCurl('note1', 'seed1');
      expect(cmd).toContain('decrypt-note.sh');
      expect(cmd).toContain('https://api.example.com/note/note1/raw seed1');
    });

    test('noteCurlSave appends an output redirect', () => {
      const cmd = gen.noteCurlSave('note1', 'seed1', 'out.txt');
      expect(cmd.endsWith(' > out.txt')).toBe(true);
      expect(cmd).toContain('decrypt-note.sh');
    });

    test('fileCurl targets the file endpoint with a filename', () => {
      const cmd = gen.fileCurl('file1', 'seed1', 'out.bin');
      expect(cmd).toContain('decrypt-file.sh');
      expect(cmd).toContain('https://api.example.com/file/file1 seed1 out.bin');
    });
  });

  describe('p2pUi', () => {
    test('p2pUi builds an /f/ link whose fragment has the p2p flag and gcm mode', () => {
      const gen = new ShareGenerator({
        apiUrl: 'https://api.x/',
        uiUrl: 'https://ui.x/',
        storeServer: false,
      });
      const link = gen.p2pUi('sess1', 'seedvalue');
      expect(link.startsWith('https://ui.x/f/sess1#')).toBe(true);
      const frag = FragmentData.fromURL(link);
      expect(frag.p2p).toBe(true);
      expect(frag.cryptoMode).toBe('gcm');
      expect(frag.seed).toBe('seedvalue');
      expect(frag.server).toBe(null);
    });

    test('p2pUi embeds the api server when storeServer is set', () => {
      const gen = new ShareGenerator({
        apiUrl: 'https://api.x/',
        uiUrl: 'https://ui.x/',
        storeServer: true,
      });
      expect(FragmentData.fromURL(gen.p2pUi('s', 'k')).server).toBe(
        'https://api.x/',
      );
    });
  });

  describe('noteServerSideDecrypt', () => {
    test('percent-encodes the seed', () => {
      const seed = 'ab+cd/ef==';
      const url = gen.noteServerSideDecrypt('note123', seed);
      expect(url).toBe(
        'https://api.example.com/note/note123/decrypt?key=ab%2Bcd%2Fef%3D%3D',
      );
      // The parsed key must match the original seed exactly.
      expect(new URL(url).searchParams.get('key')).toBe(seed);
    });
  });

  describe('CLI commands', () => {
    test.each([
      ['noteCli', ['n1', 'seed1'], "not3 note get n1 --seed 'seed1'"],
      [
        'noteCliSave',
        ['n1', 'seed1', 'my note.txt'],
        "not3 note get n1 --seed 'seed1' --output 'my note.txt'",
      ],
      [
        'fileCli',
        ['f1', 'seed1', 'my file.bin'],
        "not3 file download f1 'my file.bin' --seed 'seed1'",
      ],
      [
        'p2pCli',
        ['session1', 'seed1'],
        `not3 p2p receive 'https://ui.example.com/f/session1#${btoa('k=seed1&m=gcm&p=1')}'`,
      ],
    ])('%s builds the default command', (method, args, expected) => {
      expect(gen[method](...args)).toBe(expected);
    });

    test.each([
      [
        'noteCli',
        ['n1', 'seed1'],
        "not3 note get n1 --seed 'seed1' --server https://api.example.com",
      ],
      [
        'noteCliSave',
        ['n1', 'seed1', 'my note.txt'],
        "not3 note get n1 --seed 'seed1' --server https://api.example.com --output 'my note.txt'",
      ],
      [
        'fileCli',
        ['f1', 'seed1', 'my file.bin'],
        "not3 file download f1 'my file.bin' --seed 'seed1' --server https://api.example.com",
      ],
      [
        'p2pCli',
        ['session1', 'seed1'],
        `not3 p2p receive 'https://ui.example.com/f/session1#${btoa('k=seed1&s=https%3A%2F%2Fapi.example.com%2F&m=gcm&p=1')}'`,
      ],
    ])('%s builds the storeServer command', (method, args, expected) => {
      const withServer = new ShareGenerator({ ...opts, storeServer: true });
      expect(withServer[method](...args)).toBe(expected);
    });

    test('GCM notes include the mode flag before output', () => {
      expect(gen.noteCli('n1', 'seed1', 'gcm')).toBe(
        "not3 note get n1 --seed 'seed1' --mode gcm",
      );
      expect(gen.noteCliSave('n1', 'seed1', 'out.txt', 'gcm')).toBe(
        "not3 note get n1 --seed 'seed1' --mode gcm --output 'out.txt'",
      );
    });

    test('Bash quoting keeps apostrophes inside one argument', () => {
      expect(gen.noteCli('n1', "it's a seed")).toBe(
        String.raw`not3 note get n1 --seed 'it'\''s a seed'`,
      );
      expect(gen.noteCliSave('n1', 'seed1', "my file's.txt")).toBe(
        String.raw`not3 note get n1 --seed 'seed1' --output 'my file'\''s.txt'`,
      );
      expect(gen.fileCli('f1', 'seed1', "my file's.bin")).toBe(
        String.raw`not3 file download f1 'my file'\''s.bin' --seed 'seed1'`,
      );
    });
  });

  describe('Docker commands', () => {
    const prefix =
      'docker run --rm -it -v "$(pwd):/data" ghcr.io/not-three/cli ';

    test.each([
      ['noteDocker', ['n1', 'seed1'], "note get n1 --seed 'seed1'"],
      [
        'noteDockerSave',
        ['n1', 'seed1', 'my note.txt'],
        "note get n1 --seed 'seed1' --output 'my note.txt'",
      ],
      [
        'fileDocker',
        ['f1', 'seed1', 'my file.bin'],
        "file download f1 'my file.bin' --seed 'seed1'",
      ],
      [
        'p2pDocker',
        ['session1', 'seed1'],
        `p2p receive 'https://ui.example.com/f/session1#${btoa('k=seed1&m=gcm&p=1')}'`,
      ],
    ])('%s builds the default command', (method, args, expected) => {
      expect(gen[method](...args)).toBe(prefix + expected);
    });

    test.each([
      [
        'noteDocker',
        ['n1', 'seed1'],
        "note get n1 --seed 'seed1' --server https://api.example.com",
      ],
      [
        'noteDockerSave',
        ['n1', 'seed1', 'my note.txt'],
        "note get n1 --seed 'seed1' --server https://api.example.com --output 'my note.txt'",
      ],
      [
        'fileDocker',
        ['f1', 'seed1', 'my file.bin'],
        "file download f1 'my file.bin' --seed 'seed1' --server https://api.example.com",
      ],
      [
        'p2pDocker',
        ['session1', 'seed1'],
        `p2p receive 'https://ui.example.com/f/session1#${btoa('k=seed1&s=https%3A%2F%2Fapi.example.com%2F&m=gcm&p=1')}'`,
      ],
    ])('%s builds the storeServer command', (method, args, expected) => {
      const withServer = new ShareGenerator({ ...opts, storeServer: true });
      expect(withServer[method](...args)).toBe(prefix + expected);
    });

    test('GCM mode and custom image carry through to Docker', () => {
      const custom = new ShareGenerator({
        ...opts,
        cliImage: 'example/cli:v2',
      });
      expect(custom.noteDocker('n1', 'seed1', 'gcm')).toBe(
        'docker run --rm -it -v "$(pwd):/data" example/cli:v2 ' +
          "note get n1 --seed 'seed1' --mode gcm",
      );
      expect(custom.noteDockerSave('n1', 'seed1', 'out.txt', 'gcm')).toBe(
        'docker run --rm -it -v "$(pwd):/data" example/cli:v2 ' +
          "note get n1 --seed 'seed1' --mode gcm --output 'out.txt'",
      );
    });
  });

  describe('PowerShell commands', () => {
    const base =
      'https://raw.githubusercontent.com/not-three/main/refs/heads/main/scripts/';

    test.each([
      [
        'notePowerShell',
        ['n1', 'seed1'],
        `& ([scriptblock]::Create((irm ${base}decrypt-note.ps1))) 'https://api.example.com/note/n1/raw' 'seed1'`,
      ],
      [
        'notePowerShellSave',
        ['n1', 'seed1', 'my note.txt'],
        `& ([scriptblock]::Create((irm ${base}decrypt-note.ps1))) 'https://api.example.com/note/n1/raw' 'seed1' > 'my note.txt'`,
      ],
      [
        'filePowerShell',
        ['f1', 'seed1', 'my file.bin'],
        `& ([scriptblock]::Create((irm ${base}decrypt-file.ps1))) 'https://api.example.com/file/f1' 'seed1' 'my file.bin'`,
      ],
    ])('%s builds the default command', (method, args, expected) => {
      expect(gen[method](...args)).toBe(expected);
    });

    test.each([
      ['notePowerShell', ['n1', 'seed1']],
      ['notePowerShellSave', ['n1', 'seed1', 'my note.txt']],
      ['filePowerShell', ['f1', 'seed1', 'my file.bin']],
    ])('%s retains the command with storeServer', (method, args) => {
      const withServer = new ShareGenerator({ ...opts, storeServer: true });
      expect(withServer[method](...args)).toBe(gen[method](...args));
    });

    test('uses the custom script base and PowerShell apostrophe escaping', () => {
      const custom = new ShareGenerator({
        ...opts,
        scriptBaseUrl: 'https://scripts.example.com/',
      });
      expect(custom.notePowerShell('n1', "it's a seed")).toBe(
        "& ([scriptblock]::Create((irm https://scripts.example.com/decrypt-note.ps1))) 'https://api.example.com/note/n1/raw' 'it''s a seed'",
      );
      expect(custom.notePowerShellSave('n1', 'seed1', "my file's.txt")).toBe(
        "& ([scriptblock]::Create((irm https://scripts.example.com/decrypt-note.ps1))) 'https://api.example.com/note/n1/raw' 'seed1' > 'my file''s.txt'",
      );
      expect(custom.filePowerShell('f1', "it's a seed", "my file's.bin")).toBe(
        "& ([scriptblock]::Create((irm https://scripts.example.com/decrypt-file.ps1))) 'https://api.example.com/file/f1' 'it''s a seed' 'my file''s.bin'",
      );
    });
  });

  describe('alternatives', () => {
    const ids = (items) => items.map(({ id }) => id);
    const byId = (items, id) => items.find((item) => item.id === id);

    test('CBC note lists all alternatives in order with stable labels and descriptions', () => {
      const items = gen.alternatives({ kind: 'note', id: 'n1', seed: 'seed1' });
      expect(ids(items)).toEqual([
        'ui',
        'cli',
        'docker',
        'curl',
        'powershell',
        'server-decrypt',
      ]);
      expect(items.map(({ label }) => label)).toEqual([
        'Link',
        'CLI',
        'Docker',
        'cURL',
        'PowerShell',
        'Server-side decrypt',
      ]);
      expect(items.map(({ description }) => description)).toEqual([
        'Open this link in a browser.',
        'Needs the not3 CLI (npm i -g @not3/cli).',
        'Needs Docker, writes into the current directory.',
        'Needs curl, openssl, base64, xxd, head and tail.',
        'Windows PowerShell 5.1 or PowerShell 7, no extra tools.',
        'Decrypt on the server; the server sees the key.',
      ]);
      expect(byId(items, 'cli').value).toBe("not3 note get n1 --seed 'seed1'");
      expect(byId(items, 'curl').value).toBe(
        'curl https://raw.githubusercontent.com/not-three/main/refs/heads/main/scripts/decrypt-note.sh | bash -s https://api.example.com/note/n1/raw seed1',
      );
    });

    test('note filename selects save commands', () => {
      const items = gen.alternatives({
        kind: 'note',
        id: 'n1',
        seed: 'seed1',
        fileName: 'my note.txt',
      });
      expect(byId(items, 'cli').value).toBe(
        "not3 note get n1 --seed 'seed1' --output 'my note.txt'",
      );
      expect(byId(items, 'docker').value).toBe(
        'docker run --rm -it -v "$(pwd):/data" ghcr.io/not-three/cli ' +
          "note get n1 --seed 'seed1' --output 'my note.txt'",
      );
      expect(byId(items, 'curl').value).toBe(
        'curl https://raw.githubusercontent.com/not-three/main/refs/heads/main/scripts/decrypt-note.sh | bash -s https://api.example.com/note/n1/raw seed1 > my note.txt',
      );
      expect(byId(items, 'powershell').value).toContain(" > 'my note.txt'");
    });

    test('GCM note omits unsupported commands while preserving a supplied fragment', () => {
      const fragment = new FragmentData({
        seed: 'fragment-seed',
        server: 'https://other.example.com/',
        cryptoMode: 'gcm',
        selfDestruct: true,
      });
      const items = gen.alternatives({
        kind: 'note',
        id: 'n1',
        seed: 'command-seed',
        cryptoMode: 'gcm',
        fragment,
      });
      expect(ids(items)).toEqual(['ui', 'cli', 'docker']);
      expect(byId(items, 'ui').value).toBe(
        `https://ui.example.com/q/n1#${fragment.toString()}`,
      );
      expect(byId(items, 'cli').value).toBe(
        "not3 note get n1 --seed 'command-seed' --mode gcm",
      );
      expect(byId(items, 'docker').value).toContain(' --mode gcm');
    });

    test('file lists link, CLI, Docker, cURL and PowerShell', () => {
      const items = gen.alternatives({
        kind: 'file',
        id: 'f1',
        seed: 'seed1',
        fileName: 'my file.bin',
      });
      expect(ids(items)).toEqual(['ui', 'cli', 'docker', 'curl', 'powershell']);
      expect(byId(items, 'ui').value).toBe(
        `https://ui.example.com/f/f1#${btoa('k=seed1')}`,
      );
      expect(byId(items, 'cli').value).toBe(
        "not3 file download f1 'my file.bin' --seed 'seed1'",
      );
    });

    test('P2P lists link, CLI and Docker with server, mode and marker', () => {
      const withServer = new ShareGenerator({ ...opts, storeServer: true });
      const items = withServer.alternatives({
        kind: 'p2p',
        id: 'session1',
        seed: 'seed1',
      });
      expect(ids(items)).toEqual(['ui', 'cli', 'docker']);
      const link = `https://ui.example.com/f/session1#${btoa('k=seed1&s=https%3A%2F%2Fapi.example.com%2F&m=gcm&p=1')}`;
      expect(byId(items, 'ui').value).toBe(link);
      expect(byId(items, 'cli').value).toBe(`not3 p2p receive '${link}'`);
      expect(byId(items, 'docker').value).toBe(
        `docker run --rm -it -v "$(pwd):/data" ghcr.io/not-three/cli p2p receive '${link}'`,
      );
    });

    test('legacy cURL commands remain byte-identical with custom script base', () => {
      const custom = new ShareGenerator({
        ...opts,
        scriptBaseUrl: 'https://scripts.example.com/',
      });
      expect(custom.noteCurl('n1', 'seed1')).toBe(
        'curl https://raw.githubusercontent.com/not-three/main/refs/heads/main/scripts/decrypt-note.sh | bash -s https://api.example.com/note/n1/raw seed1',
      );
      expect(custom.noteCurlSave('n1', 'seed1', 'my note.txt')).toBe(
        'curl https://raw.githubusercontent.com/not-three/main/refs/heads/main/scripts/decrypt-note.sh | bash -s https://api.example.com/note/n1/raw seed1 > my note.txt',
      );
      expect(custom.fileCurl('f1', 'seed1', 'my file.bin')).toBe(
        'curl https://raw.githubusercontent.com/not-three/main/refs/heads/main/scripts/decrypt-file.sh | bash -s https://api.example.com/file/f1 seed1 my file.bin',
      );
    });
  });
});
