const { FragmentData, Crypto } = require('../../dist/index.cjs');

describe('FragmentData', () => {
  describe('constructor defaults', () => {
    test('applies defaults when only a seed is given', () => {
      const f = new FragmentData({ seed: 'abc' });
      expect(f.seed).toBe('abc');
      expect(f.server).toBeNull();
      expect(f.selfDestruct).toBe(false);
      expect(f.cryptoMode).toBe('cbc');
    });

    test('keeps provided values', () => {
      const f = new FragmentData({
        seed: 'abc',
        server: 'https://api.example.com/',
        selfDestruct: true,
        cryptoMode: 'gcm',
      });
      expect(f.server).toBe('https://api.example.com/');
      expect(f.selfDestruct).toBe(true);
      expect(f.cryptoMode).toBe('gcm');
    });

    test('coerces an empty-string server to null', () => {
      const f = new FragmentData({ seed: 'abc', server: '' });
      expect(f.server).toBeNull();
    });
  });

  describe('toString', () => {
    test('omits defaults (no server, cbc, no self-destruct)', () => {
      const f = new FragmentData({ seed: 'abc' });
      const decoded = atob(f.toString());
      const params = new URLSearchParams(decoded);
      expect(params.get('k')).toBe('abc');
      expect(params.has('s')).toBe(false);
      expect(params.has('d')).toBe(false);
      expect(params.has('m')).toBe(false);
    });

    test('includes non-default values', () => {
      const f = new FragmentData({
        seed: 'abc',
        server: 'https://api.example.com/',
        selfDestruct: true,
        cryptoMode: 'gcm',
      });
      const params = new URLSearchParams(atob(f.toString()));
      expect(params.get('s')).toBe('https://api.example.com/');
      expect(params.get('d')).toBe('1');
      expect(params.get('m')).toBe('gcm');
    });
  });

  describe('fromURL', () => {
    test('parses a fragment produced by toString', () => {
      const original = new FragmentData({
        seed: Crypto.generateSeed(),
        server: 'https://api.example.com/',
        selfDestruct: true,
        cryptoMode: 'gcm',
      });
      const url = `https://ui.example.com/q/note1#${original.toString()}`;
      const parsed = FragmentData.fromURL(url);
      expect(parsed.seed).toBe(original.seed);
      expect(parsed.server).toBe(original.server);
      expect(parsed.selfDestruct).toBe(true);
      expect(parsed.cryptoMode).toBe('gcm');
    });

    test('round-trips seeds containing "+", "/" and "=" (deterministic)', () => {
      // These are the base64 characters that are unsafe in a query string:
      // '+' would otherwise decode back to a space. Cover them explicitly so
      // the edge case is exercised on every run, not just probabilistically.
      const seeds = [
        'ab+cd/ef==',
        '+++///===',
        'In89tNsi54tjvgOsNZ/ykCGgqokz7rzD+iu8YPOtu8s=',
        'a+b/c+d/e+f/=',
      ];
      for (const seed of seeds) {
        const url = `https://ui/#${new FragmentData({ seed }).toString()}`;
        expect(FragmentData.fromURL(url).seed).toBe(seed);
      }
    });

    test('round-trips arbitrary generated seeds (fuzz, 500 random)', () => {
      for (let i = 0; i < 500; i++) {
        const seed = Crypto.generateSeed();
        const url = `https://ui/#${new FragmentData({ seed }).toString()}`;
        expect(FragmentData.fromURL(url).seed).toBe(seed);
      }
    });

    test('defaults cryptoMode to cbc when "m" is absent', () => {
      const url = `https://ui/#${new FragmentData({ seed: 'abc' }).toString()}`;
      expect(FragmentData.fromURL(url).cryptoMode).toBe('cbc');
    });

    test('throws when the seed is missing', () => {
      const fragment = btoa(new URLSearchParams({ d: '1' }).toString());
      expect(() => FragmentData.fromURL(`https://ui/#${fragment}`)).toThrow('Seed is required');
    });
  });
});
