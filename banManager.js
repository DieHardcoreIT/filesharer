// Fail2Ban like ban manager

const banThreshold = 5; // Max failed attempts
const banDuration = 20 * 60 * 1000; // 20 minutes

const failedAttempts = new Map(); // IP => { count, lastAttempt, bannedUntil }

function IsBanned(ip)
{
    const record = failedAttempts.get(ip);
    if (!record)
    {
        return false;
    }

    if (record.bannedUntil && Date.now() < record.bannedUntil)
    {
        return true;
    }

    // Cleanup expired bans
    if (record.bannedUntil && Date.now() >= record.bannedUntil)
    {
        failedAttempts.delete(ip);
    }

    return false;
}

function RecordFailedAttempt(ip)
{
    const now = Date.now();
    let record = failedAttempts.get(ip);

    if (!record)
    {
        record = { count: 0, lastAttempt: 0 };
    }

    // Reset if the last attempt was long ago
    if (now - record.lastAttempt > 30 * 60 * 1000)
    {
        record.count = 0;
    }

    record.count += 1;
    record.lastAttempt = now;

    if (record.count >= banThreshold)
    {
        record.bannedUntil = now + banDuration;
    }

    failedAttempts.set(ip, record);
}

function ResetAttempts(ip)
{
    failedAttempts.delete(ip);
}

export { IsBanned, RecordFailedAttempt, ResetAttempts };
