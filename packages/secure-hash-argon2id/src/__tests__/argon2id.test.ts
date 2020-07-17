import SecureHash from '../';

jest.setTimeout(50000);
const OLD_HASH =
  'JGFyZ29uMmlkJHY9MTkkbT05Mjc3NCx0PTI5LHA9MSRqQUI2SDlhbFN1bWhTWWxFYmdleFFBJDd6a3N3K3ZUVTQ4ZnJVTmEvVjRsenZ5aVRNUGRLd2wyTlh5SUsvdGhpMVUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const OPS_LIMIT = 21;
const MEM_LIMIT = '65MB';
test('argon2id', async () => {
  const sh = SecureHash({
    opsLimit: OPS_LIMIT,
    memLimit: MEM_LIMIT,
  });

  const start = Date.now();
  const hash = await sh.hash('Hello World');
  const end = Date.now();
  expect(end - start).toBeGreaterThan(100);
  const start2 = Date.now();
  const verified = await sh.verify('Hello World', hash, async _updatedHash => {
    expect(false).toBe(true);
  });
  const end2 = Date.now();
  expect(end2 - start2).toBeGreaterThan(100);
  expect(verified).toBe(true);

  // hashing the same password multiple times should produce different results because passwords are salted
  const hash2 = await sh.hash('Hello World');
  expect(hash).not.toEqual(hash2);
});

test('argon2id update', async () => {
  const sh = SecureHash({
    opsLimit: OPS_LIMIT,
    memLimit: MEM_LIMIT,
  });

  let updated = false;
  const start = Date.now();
  const verified = await sh.verify(
    'Hello World',
    OLD_HASH,
    async updatedHash => {
      updated = true;
      const verified = await sh.verify(
        'Hello World',
        updatedHash,
        async updatedHash => {
          expect(false).toBe(true);
        },
      );
      expect(verified).toBe(true);
    },
  );
  const end = Date.now();
  expect(updated).toBe(true);
  expect(end - start).toBeGreaterThan(500);
  expect(verified).toBe(true);
});