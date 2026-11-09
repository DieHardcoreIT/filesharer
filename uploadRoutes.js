import express from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { checkDiskSpace } from 'check-disk-space';
import {
    uploadsDir, tmpChunksDir, maxFileSize, defaultExpiry, fileMetadata,
    CalculateDeletionTime, SaveMetadata
} from './fileStorage.js';
import { GenerateId, CreateShareDetails } from './sharing.js';

// Each request stays well below Cloudflare's standard 100 MB request limit.
const chunkSize = 8 * 1024 * 1024;
const sessionLifetime = 60 * 60 * 1000;
const activeUploads = new Map();
const uploadRouter = express.Router();
const chunkUpload = multer({
    dest: tmpChunksDir,
    limits: { fileSize: chunkSize, files: 1, fields: 2, fieldSize: 1024, parts: 3 }
}).single('chunk');

uploadRouter.post('/initiate', async (req, res) =>
{
    const { fileName, fileSize, fileHash, expiry } = req.body ?? {};
    if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 255 ||
        !Number.isSafeInteger(fileSize) || fileSize < 0 ||
        (fileHash !== undefined && (typeof fileHash !== 'string' || !/^[a-f0-9]{64}$/i.test(fileHash))))
    {
        return res.status(400).json({ success: false, error: 'Invalid fileName, fileSize or SHA-256 fileHash.' });
    }
    if (fileSize > maxFileSize)
    {
        return res.status(413).json({ success: false, error: `Maximum file size is ${maxFileSize / (1024 * 1024)} MB.` });
    }

    try
    {
        const diskSpace = await checkDiskSpace(uploadsDir);
        // Chunks and the assembled file coexist until finalization completes.
        if (diskSpace.free < fileSize * 2)
        {
            return res.status(507).json({ success: false, error: 'Insufficient storage space to save the file.' });
        }
        const uploadId = crypto.randomUUID();
        const uploadDir = path.join(tmpChunksDir, uploadId);
        await fs.mkdir(uploadDir);
        activeUploads.set(uploadId, {
            fileName, fileSize, fileHash: fileHash?.toLowerCase(), expiry: expiry || defaultExpiry,
            path: uploadDir, totalChunks: Math.max(1, Math.ceil(fileSize / chunkSize)),
            lastActivity: Date.now(), finalizing: false
        });
        res.json({ success: true, uploadId, chunkSize });
    }
    catch (error)
    {
        console.error('Could not initiate upload:', error);
        res.status(500).json({ success: false, error: 'Could not initiate upload session.' });
    }
});

uploadRouter.post('/chunk', (req, res, next) =>
{
    chunkUpload(req, res, (error) =>
    {
        if (error)
        {
            const status = error instanceof multer.MulterError ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : 500;
            return res.status(status).json({ success: false, error: 'Could not receive chunk. Maximum chunk size is 8 MiB.' });
        }
        next();
    });
}, async (req, res) =>
{
    if (!req.file)
    {
        return res.status(400).json({ success: false, error: 'Chunk data is required.' });
    }
    const { uploadId, chunkNumber } = req.body;
    const session = activeUploads.get(uploadId);
    const number = Number(chunkNumber);

    try
    {
        if (!session)
        {
            return res.status(404).json({ success: false, error: 'Upload ID not found or expired.' });
        }
        if (session.finalizing)
        {
            return res.status(409).json({ success: false, error: 'Upload is being finalized.' });
        }
        if (typeof chunkNumber !== 'string' || !/^[1-9]\d*$/.test(chunkNumber) || !Number.isSafeInteger(number) || number > session.totalChunks)
        {
            return res.status(400).json({ success: false, error: 'Invalid chunk number.' });
        }
        const expectedSize = number === session.totalChunks ? session.fileSize - (number - 1) * chunkSize : chunkSize;
        if (req.file.size !== expectedSize)
        {
            return res.status(400).json({ success: false, error: 'Chunk size does not match the declared file size.' });
        }
        session.lastActivity = Date.now();
        // Replacing a numbered chunk makes retries safe after a lost response.
        await fs.rename(req.file.path, path.join(session.path, `chunk-${number}`));
        res.json({ success: true });
    }
    finally
    {
        await fs.rm(req.file.path, { force: true });
    }
});

uploadRouter.post('/finalize', async (req, res) =>
{
    const { uploadId, totalChunks } = req.body ?? {};
    const session = activeUploads.get(uploadId);
    if (!session)
    {
        return res.status(404).json({ success: false, error: 'Upload ID not found or expired.' });
    }
    if (session.finalizing)
    {
        return res.status(409).json({ success: false, error: 'Upload is being finalized.' });
    }
    if (!Number.isSafeInteger(totalChunks) || totalChunks !== session.totalChunks)
    {
        return res.status(400).json({ success: false, error: 'Invalid totalChunks.' });
    }

    session.finalizing = true;
    const id = GenerateId();
    const finalPath = path.join(uploadsDir, id);
    let file;
    let result;
    let status = 200;
    try
    {
        const hash = session.fileHash ? crypto.createHash('sha256') : null;
        file = await fs.open(finalPath, 'wx');
        let size = 0;
        try
        {
            for (let number = 1; number <= totalChunks; number++)
            {
                const chunk = await fs.readFile(path.join(session.path, `chunk-${number}`));
                size += chunk.length;
                hash?.update(chunk);
                // Await each write and close before publishing the download link.
                await file.writeFile(chunk);
            }
        }
        finally
        {
            await file.close();
        }
        if (size !== session.fileSize || (hash && hash.digest('hex') !== session.fileHash))
        {
            throw new Error('File size or SHA-256 hash mismatch.');
        }

        const deleteAt = CalculateDeletionTime(session.expiry);
        const details = await CreateShareDetails(req, `/d/${id}`, deleteAt);
        fileMetadata[id] = {
            originalName: session.fileName, path: finalPath, timestamp: new Date().toISOString(),
            deleteAt, expirySetting: session.expiry
        };
        await SaveMetadata();
        result = { ...details, fileName: session.fileName };
    }
    catch (error)
    {
        console.error(`Could not finalize upload ${uploadId}:`, error);
        if (file)
        {
            await fs.rm(finalPath, { force: true });
        }
        status = 400;
        result = { success: false, error: 'Could not assemble file. Chunks are missing or the file is corrupt.' };
    }
    finally
    {
        await fs.rm(session.path, { recursive: true, force: true });
        activeUploads.delete(uploadId);
    }
    res.status(status).json(result);
});

uploadRouter.delete('/:uploadId', async (req, res) =>
{
    const session = activeUploads.get(req.params.uploadId);
    if (session?.finalizing)
    {
        return res.status(409).json({ success: false, error: 'Upload is being finalized.' });
    }
    if (session)
    {
        activeUploads.delete(req.params.uploadId);
        await fs.rm(session.path, { recursive: true, force: true });
    }
    res.json({ success: true });
});

async function CleanupAbandonedUploads()
{
    const cutoff = Date.now() - sessionLifetime;
    for (const [id, session] of activeUploads)
    {
        if (!session.finalizing && session.lastActivity < cutoff)
        {
            activeUploads.delete(id);
            await fs.rm(session.path, { recursive: true, force: true });
        }
    }
    // Include orphaned sessions and temporary multipart files left by a restart.
    for (const entry of await fs.readdir(tmpChunksDir))
    {
        if (!activeUploads.has(entry))
        {
            const entryPath = path.join(tmpChunksDir, entry);
            const stat = await fs.stat(entryPath).catch(error =>
            {
                if (error.code !== 'ENOENT')
                {
                    throw error;
                }
            });
            if (stat && stat.mtimeMs < cutoff)
            {
                await fs.rm(entryPath, { recursive: true, force: true });
            }
        }
    }
}

export { uploadRouter, CleanupAbandonedUploads };
