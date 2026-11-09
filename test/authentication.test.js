import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HashPassword, VerifyPassword, ValidatePasswordHash, CreateSession, HasSession, CleanupSessions, sessionLifetime } from '../authentication.js';

test('salted password hashes verify exact passwords and reject verifier replay', async () =>
{
    const password = ' a long ünicode passphrase ';
    const firstHash = await HashPassword(password);
    const secondHash = await HashPassword(password);
    assert.notEqual(firstHash, secondHash);
    ValidatePasswordHash(firstHash);
    assert.equal(await VerifyPassword(password, firstHash), true);
    assert.equal(await VerifyPassword(password.trim(), firstHash), false);
    assert.equal(await VerifyPassword(firstHash, firstHash), false);
    assert.equal(await VerifyPassword({ password }, firstHash), false);
    assert.throws(() => ValidatePasswordHash('plaintext'));
});

test('sessions are random and expire on the server even when their cookie is replayed', (context) =>
{
    const now = Date.now();
    context.mock.method(Date, 'now', () => now);
    const token = CreateSession();
    assert.notEqual(CreateSession(), token);
    assert.equal(HasSession(token), true);
    assert.equal(HasSession('a'.repeat(64)), false);
    context.mock.method(Date, 'now', () => now + sessionLifetime);
    assert.equal(HasSession(token), false);
    CleanupSessions();
});
