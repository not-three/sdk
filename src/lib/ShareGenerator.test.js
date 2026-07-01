const { ShareGenerator } = require('../../dist/index.cjs');

describe('ShareGenerator', () => {
  const gen = new ShareGenerator({ apiUrl: 'https://api.example.com/' });

  test('noteServerSideDecrypt percent-encodes the seed', () => {
    const seed = 'ab+cd/ef==';
    const url = gen.noteServerSideDecrypt('note123', seed);
    expect(url).toBe('https://api.example.com/note/note123/decrypt?key=ab%2Bcd%2Fef%3D%3D');
    // The parsed key must match the original seed exactly.
    const parsed = new URL(url).searchParams.get('key');
    expect(parsed).toBe(seed);
  });
});
