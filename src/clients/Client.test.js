const { Not3Client, NotesAPI, SystemAPI, FilesAPI } = require('../../dist/index.cjs');

describe('Not3Client', () => {
  describe('options management', () => {
    test('getOptions returns the options passed to the constructor', () => {
      const client = new Not3Client({ baseUrl: 'https://api.example.com/' });
      expect(client.getOptions()).toEqual({ baseUrl: 'https://api.example.com/' });
    });

    test('setOptions replaces the options', () => {
      const client = new Not3Client({ baseUrl: 'https://a/' });
      client.setOptions({ baseUrl: 'https://b/', password: 'pw' });
      expect(client.getOptions()).toEqual({ baseUrl: 'https://b/', password: 'pw' });
    });

    test('updateOptions merges with the existing options', () => {
      const client = new Not3Client({ baseUrl: 'https://a/', password: 'pw' });
      client.updateOptions({ password: 'new' });
      expect(client.getOptions()).toEqual({ baseUrl: 'https://a/', password: 'new' });
    });
  });

  describe('sub-client factories', () => {
    const client = new Not3Client({ baseUrl: 'https://api.example.com/' });
    test('notes() returns a NotesAPI', () => expect(client.notes()).toBeInstanceOf(NotesAPI));
    test('system() returns a SystemAPI', () => expect(client.system()).toBeInstanceOf(SystemAPI));
    test('files() returns a FilesAPI', () => expect(client.files()).toBeInstanceOf(FilesAPI));
    test('each call returns a fresh instance', () => {
      expect(client.notes()).not.toBe(client.notes());
    });
  });

  describe('getVersionRange', () => {
    test('is the expected v2 range', () => {
      const client = new Not3Client({ baseUrl: 'https://a/' });
      expect(client.getVersionRange()).toBe('>=2.0.0 <3.0.0');
    });
  });

  describe('isCompatible', () => {
    const client = new Not3Client({ baseUrl: 'https://a/' });
    const fakeSystem = version => ({ info: async () => ({ version }) });

    test('true when the API version is within range', async () => {
      expect(await client.isCompatible(fakeSystem('2.5.0'))).toBe(true);
    });

    test('false when the API version is out of range', async () => {
      expect(await client.isCompatible(fakeSystem('3.0.0'))).toBe(false);
      expect(await client.isCompatible(fakeSystem('1.9.0'))).toBe(false);
    });

    test('always true for the IN-DEV version', async () => {
      expect(await client.isCompatible(fakeSystem('IN-DEV'))).toBe(true);
    });

    test('false when fetching info throws', async () => {
      const throwing = { info: async () => { throw new Error('network'); } };
      expect(await client.isCompatible(throwing)).toBe(false);
    });
  });
});
