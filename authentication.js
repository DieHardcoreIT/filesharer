import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const DeriveKey = promisify(scrypt);
// OWASP's 32 MiB profile fits the application's 256 MiB container limit.
const hashOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const hashPattern = /^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{128})$/;
export const sessionLifetime = 30 * 60 * 1000;
const sessions = new Map();
let activeVerifications = 0;

export async function HashPassword(password)
{
    if (typeof password !== 'string' || password.length === 0 || Buffer.byteLength(password) > 1024)
    {
        throw new Error('Password must contain between 1 and 1024 UTF-8 bytes.');
    }
    const salt = randomBytes(16);
    const key = await DeriveKey(password, salt, 64, hashOptions);
    return `scrypt-v1:${salt.toString('hex')}:${key.toString('hex')}`;
}

export function ValidatePasswordHash(passwordHash)
{
    if (typeof passwordHash !== 'string' || !hashPattern.test(passwordHash))
    {
        throw new Error('Set APP_UPLOAD_PASSWORD_HASH using npm run password:hash. Plaintext password configuration is no longer supported.');
    }
}

export async function VerifyPassword(password, passwordHash)
{
    if (typeof password !== 'string' || password.length === 0 || Buffer.byteLength(password) > 1024)
    {
        return false;
    }
    // Bound expensive concurrent work instead of allowing authentication to exhaust RAM.
    if (activeVerifications >= 2)
    {
        const error = new Error('Authentication busy; please retry.');
        error.status = 429;
        throw error;
    }
    activeVerifications++;
    try
    {
        const [, salt, expectedKey] = passwordHash.match(hashPattern);
        const key = await DeriveKey(password, Buffer.from(salt, 'hex'), 64, hashOptions);
        return timingSafeEqual(key, Buffer.from(expectedKey, 'hex'));
    }
    finally
    {
        activeVerifications--;
    }
}

function SessionKey(token)
{
    return createHash('sha256').update(token).digest('hex');
}

export function CreateSession()
{
    CleanupSessions();
    const token = randomBytes(32).toString('hex');
    sessions.set(SessionKey(token), Date.now() + sessionLifetime);
    return token;
}

export function HasSession(token)
{
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
    {
        return false;
    }
    const key = SessionKey(token);
    const expiresAt = sessions.get(key);
    if (expiresAt === undefined || expiresAt <= Date.now())
    {
        sessions.delete(key);
        return false;
    }
    return true;
}

export function CleanupSessions()
{
    for (const [key, expiresAt] of sessions)
    {
        if (expiresAt <= Date.now())
        {
            sessions.delete(key);
        }
    }
}
