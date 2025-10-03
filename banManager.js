// Fail2Ban like ban manager

const BAN_THRESHOLD = 5;             // Max failed attempts
const BAN_DURATION = 20 * 60 * 1000; // 20 minutes

const failedAttempts = new Map(); // IP => { count, lastAttempt, bannedUntil }

function isBanned(ip) {
    const record = failedAttempts.get(ip);
    if (!record) return false;

    if (record.bannedUntil && Date.now() < record.bannedUntil) {
        return true;
    }

    // Cleanup expired bans
    if (record.bannedUntil && Date.now() >= record.bannedUntil) {
        failedAttempts.delete(ip);
    }

    return false;
}

function recordFailedAttempt(ip) {
    const now = Date.now();
    let record = failedAttempts.get(ip);

    if (!record) {
        record = { count: 0, lastAttempt: 0 };
    }

    // Reset if the last attempt was long ago
    if (now - record.lastAttempt > 30 * 60 * 1000)
        record.count = 0;

    record.count += 1;
    record.lastAttempt = now;

    if (record.count >= BAN_THRESHOLD) {
        record.bannedUntil = now + BAN_DURATION;
    }

    failedAttempts.set(ip, record);
}

function resetAttempts(ip) {
    failedAttempts.delete(ip);
}

module.exports = { isBanned, recordFailedAttempt, resetAttempts };