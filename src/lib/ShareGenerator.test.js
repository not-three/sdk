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

  describe('noteServerSideDecrypt', () => {
    test('percent-encodes the seed', () => {
      const seed = 'ab+cd/ef==';
      const url = gen.noteServerSideDecrypt('note123', seed);
      expect(url).toBe('https://api.example.com/note/note123/decrypt?key=ab%2Bcd%2Fef%3D%3D');
      // The parsed key must match the original seed exactly.
      expect(new URL(url).searchParams.get('key')).toBe(seed);
    });
  });
});
