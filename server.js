import express from 'express';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checkDiskSpace } from 'check-disk-space';
import cookieParser from 'cookie-parser';
import expressLayouts from 'express-ejs-layouts';
import { IsBanned, RecordFailedAttempt, ResetAttempts } from './banManager.js';
import fsPromises from 'node:fs/promises';
import {
    uploadsDir,
    fileMetadata,
    defaultExpiry,
    maxFileSize,
    EnsureDataDirectories,
    LoadMetadata,
    SaveMetadata,
    CalculateDeletionTime,
    CleanupExpiredFiles
} from './fileStorage.js';
import { GenerateId, CreateShareDetails } from './sharing.js';
import { uploadRouter, CleanupAbandonedUploads } from './uploadRoutes.js';
import { ValidatePasswordHash, VerifyPassword, CreateSession, HasSession, CleanupSessions, sessionLifetime } from './authentication.js';

const app = express();
app.locals.showHeader = true;
const port = process.env.PORT || 3000;
const zipLibraryPath = path.join(import.meta.dirname, 'node_modules/@zip.js/zip.js/dist/zip.min.js');
const assetVersions = new Map();

// A new asset URL bypasses browser and proxy caches after a deployment.
// Files remain read-only for the lifetime of the production container.
app.locals.AssetUrl = (assetPath) =>
{
    if (!assetVersions.has(assetPath))
    {
        const filePath = assetPath === '/vendor/zip.min.js' ? zipLibraryPath : path.join(import.meta.dirname, 'public', assetPath);
        assetVersions.set(assetPath, createHash('sha256').update(readFileSync(filePath)).digest('hex').slice(0, 16));
    }
    return `${assetPath}?v=${assetVersions.get(assetPath)}`;
};

const passwordHash = process.env.APP_UPLOAD_PASSWORD_HASH;
try
{
    ValidatePasswordHash(passwordHash);
    if (process.env.APP_UPLOAD_PASSWORD !== undefined)
    {
        throw new Error('Remove APP_UPLOAD_PASSWORD from the environment; configure only APP_UPLOAD_PASSWORD_HASH.');
    }
}
catch (error)
{
    console.error(error.message);
    process.exit(1);
}

const cleanupInterval = 60 * 1000;

function FormatBytes(bytes, decimals = 2)
{
    if (bytes === null || typeof bytes === 'undefined' || bytes === 0)
    {
        return '0 Bytes';
    }
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

const AuthenticateApi = async (req, res, next) =>
{
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer '))
    {
        return res.status(401).json({ success: false, error: 'Authorization header missing or malformed' });
    }

    const token = authHeader.slice(7);
    if (!await VerifyPassword(token, passwordHash))
    {
        RecordFailedAttempt(req.clientIp);
        return res.status(401).json({ success: false, error: 'Invalid API key' });
    }

    ResetAttempts(req.clientIp);

    next();
};

function Fail2BanMiddleware(req, res, next)
{
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;

    if (IsBanned(ip))
    {
        return res.status(403).send();
    }

    req.clientIp = ip;
    next();
}

app.set('view engine', 'ejs');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(import.meta.dirname, 'public')));
app.get('/vendor/zip.min.js', (req, res) =>
{
    res.sendFile(zipLibraryPath);
});

app.use(cookieParser());
app.use(Fail2BanMiddleware);
app.use('/api/v1/upload', AuthenticateApi, uploadRouter);
app.use('/upload', IsAuthenticated, uploadRouter);
app.use(expressLayouts);

app.get('/', (req, res) =>
{
    res.render('index', { showHeader: false });
});

app.get('/dashboard', async (req, res) =>
{
    res.set('Cache-Control', 'no-store');
    if (!HasSession(req.cookies.session))
    {
        res.render('index', { showHeader: false });

        return;
    }

    try
    {
        const diskSpace = await checkDiskSpace(uploadsDir);
        const free = diskSpace.free;
        const total = diskSpace.size;
        const used = total - free;
        const percentUsed = (used / total) * 100;

        res.render('dashboard', {
            diskSpaceInfo: {
                free: FormatBytes(diskSpace.free),
                size: FormatBytes(diskSpace.size),
                percentUsed: percentUsed.toFixed(2)
            }
        });
    }
    catch (error)
    {
        console.error('Error checking disk space:', error);
        res.status(500).send('Unable to read disk space.');
    }
});

app.post('/verify-password', async (req, res) =>
{
    const { password } = req.body;
    if (await VerifyPassword(password, passwordHash))
    {
        ResetAttempts(req.clientIp);

        res.clearCookie('login');
        res.cookie('session', CreateSession(), {
            maxAge: sessionLifetime,
            httpOnly: true,
            sameSite: 'lax',
            secure: req.secure || process.env.FORCE_HTTPS_LINKS === 'true'
        });

        res.status(200).json({
            success: true
        });
    }
    else
    {
        RecordFailedAttempt(req.clientIp);

        res.status(401).json({ success: false, message: 'Invalid access code' });
    }
});

app.post('/share-text', IsAuthenticated, async (req, res) =>
{
    let { content, contentType, expiry } = req.body;

    if (!content || !contentType)
    {
        return res.status(400).json({ success: false, error: 'Content and content type are required!' });
    }

    if (!['text', 'link'].includes(contentType))
    {
        return res.status(400).json({ success: false, error: "Content type must be 'text' or 'link'!" });
    }

    if (contentType === 'link' && !content.includes('://'))
    {
        content = 'https://' + content;
    }

    try
    {
        const id = GenerateId();
        const expiryOption = expiry || defaultExpiry;
        const deleteAt = CalculateDeletionTime(expiryOption);

        fileMetadata[id] = {
            originalName: contentType === 'link' ? 'Shared Link' : 'Shared Text',
            content,
            contentType,
            timestamp: new Date().toISOString(),
            deleteAt,
            expirySetting: expiryOption,
            isTextContent: true
        };
        await SaveMetadata();

        res.status(200).json({
            ...(await CreateShareDetails(req, `/s/${id}`, deleteAt)),
            contentType
        });
    }
    catch (err)
    {
        console.error('Error sharing text/link:', err);
        res.status(500).json({ success: false, error: 'Error processing share request.' });
    }
});

function IsAuthenticated(req, res, next)
{
    if (!HasSession(req.cookies.session))
    {
        return res.status(403).json({ success: false, error: 'Invalid access code!' });
    }

    next();
}

app.get('/s/:id', (req, res) =>
{
    const id = req.params.id;
    const metadata = fileMetadata[id];

    if (!metadata || !metadata.isTextContent)
    {
        return res.status(404).send('Content not found or link invalid/expired.');
    }
    if (metadata.deleteAt && metadata.deleteAt <= Date.now())
    {
        return res.status(404).send('Content has expired and was deleted.');
    }

    res.render('shared-content', {
        content: metadata.content,
        contentType: metadata.contentType
    });
});

app.get('/d/:id', (req, res) =>
{
    const id = req.params.id;
    const metadata = fileMetadata[id];

    if (!metadata)
    {
        return res.status(404).send('File not found or link invalid/expired.');
    }
    if (metadata.deleteAt && metadata.deleteAt <= Date.now())
    {
        return res.status(404).send('File has expired and was deleted.');
    }

    if (metadata.isTextContent)
    {
        return res.redirect(`/s/${id}`);
    }

    fsPromises
        .access(metadata.path)
        .then(() =>
        {
            res.download(metadata.path, metadata.originalName, (err) =>
            {
                if (err)
                {
                    console.error('Fehler beim Senden der Datei:', err);
                    if (!res.headersSent)
                    {
                        res.status(500).send('Error downloading file.');
                    }
                }
            });
        })
        .catch(() =>
        {
            console.error(`Datei für ID ${id} nicht im Dateisystem gefunden: ${metadata.path}`);
            res.status(404).send('File not found in filesystem. Link may be outdated.');
        });
});

app.get('/upload-success', (req, res) =>
{
    res.render('upload-success');
});

app.use((error, req, res, next) =>
{
    if (error.status === 429)
    {
        res.set('Retry-After', '1');
        return res.status(429).json({ success: false, error: 'Authentication busy; please retry.' });
    }
    next(error);
});

async function StartServer()
{
    await EnsureDataDirectories();
    await LoadMetadata();
    const Cleanup = async () =>
    {
        try
        {
            await CleanupExpiredFiles();
            await CleanupAbandonedUploads();
            CleanupSessions();
        }
        catch (error)
        {
            console.error('Cleanup failed:', error);
        }
    };
    await Cleanup();
    setInterval(Cleanup, cleanupInterval);
    console.log(`Automatic file cleanup active (Checking every ${cleanupInterval / 1000} seconds).`);

    const server = app.listen(port, () =>
    {
        console.log(`FileSharer läuft auf http://localhost:${port}`);
        console.log(`Upload-Verzeichnis: ${uploadsDir}`);
        console.log(`Max file size: ${FormatBytes(maxFileSize)}`);
    });

    // Increased server timeouts for very large uploads
    server.setTimeout(2 * 60 * 60 * 1000); // 2 Hour timeout
    server.headersTimeout = 2 * 60 * 60 * 1000 + 5000; // Slightly longer than server.timeout
}

StartServer();
