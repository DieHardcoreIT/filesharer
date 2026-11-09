import path from 'node:path';
import fsPromises from 'node:fs/promises';

const dataBaseDir = import.meta.dirname;
const uploadsDir = path.join(dataBaseDir, 'uploads');
const metadataDir = path.join(dataBaseDir, 'metadata');
const metadataFile = path.join(metadataDir, 'fileMetadata.json');
const tmpChunksDir = path.join(dataBaseDir, 'tmp_chunks');

const maxFileSize = Number(process.env.MAX_FILE_SIZE ?? 250) * 1024 * 1024;
if (!Number.isSafeInteger(maxFileSize) || maxFileSize <= 0)
{
    throw new Error('MAX_FILE_SIZE must specify a positive file size in MB.');
}

let fileMetadata = {};

const expiryOptions = {
    '1h': 1 * 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 1 * 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
};
const defaultExpiry = '4h';

async function EnsureDataDirectories()
{
    try
    {
        await fsPromises.mkdir(uploadsDir, { recursive: true });
        await fsPromises.mkdir(metadataDir, { recursive: true });
        await fsPromises.mkdir(tmpChunksDir, { recursive: true });
        console.log(`Uploads directory: ${uploadsDir}`);
        console.log(`Metadata directory: ${metadataDir}`);
        console.log(`Temp chunks directory: ${tmpChunksDir}`);
    }
    catch (err)
    {
        console.error('Error creating data directories:', err);
        process.exit(1);
    }
}

async function LoadMetadata()
{
    try
    {
        const data = await fsPromises.readFile(metadataFile, 'utf8');
        fileMetadata = JSON.parse(data);
        console.log('Metadata loaded.');
    }
    catch (err)
    {
        if (err.code === 'ENOENT')
        {
            console.log('Metadata file not found, starting with empty list.');
            fileMetadata = {};
        }
        else
        {
            console.error('Error loading metadata:', err);
        }
    }
}

async function SaveMetadata()
{
    try
    {
        await fsPromises.writeFile(metadataFile, JSON.stringify(fileMetadata, null, 2));
    }
    catch (err)
    {
        console.error('Error saving metadata:', err);
    }
}

function CalculateDeletionTime(expiryOption)
{
    const duration = expiryOptions[expiryOption] || expiryOptions[defaultExpiry];
    return Date.now() + duration;
}

async function CleanupExpiredFiles()
{
    const now = Date.now();
    let changed = false;
    for (const id in fileMetadata)
    {
        if (fileMetadata[id].deleteAt && fileMetadata[id].deleteAt <= now)
        {
            console.log(`Delete expired file: ${fileMetadata[id].originalName} (ID: ${id})`);

            // Text and Link content are only stored in the "metadata" and has no file representation
            if (fileMetadata[id].path !== undefined)
            {
                try
                {
                    await fsPromises.unlink(fileMetadata[id].path);
                    console.log(`File ${fileMetadata[id].path} successfully deleted.`);
                }
                catch (err)
                {
                    if (err.code === 'ENOENT')
                    {
                        console.warn(`File ${fileMetadata[id].path} for ID ${id} not found, already deleted?`);
                    }
                    else
                    {
                        console.error(`Error deleting the file ${fileMetadata[id].path}:`, err);
                    }
                }
            }

            delete fileMetadata[id];
            changed = true;
        }
    }
    if (changed)
    {
        await SaveMetadata();
        console.log('Metadata updated after cleanup.');
    }
}

export {
    uploadsDir,
    maxFileSize,
    tmpChunksDir,
    fileMetadata,
    defaultExpiry,
    EnsureDataDirectories,
    LoadMetadata,
    SaveMetadata,
    CalculateDeletionTime,
    CleanupExpiredFiles
};
