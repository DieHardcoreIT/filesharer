async function ReadDroppedEntries(dataTransfer)
{
    // Obtain entries before yielding: browsers protect drag data after the drop event.
    const roots = Array.from(dataTransfer.items || [], item => item.webkitGetAsEntry?.()).filter(Boolean);
    if (roots.length === 0)
    {
        return Array.from(dataTransfer.files, file => ({ file, path: file.name }));
    }
    const entries = [];
    for (const root of roots)
    {
        await ReadDirectoryEntry(root, '', entries);
    }
    return entries;
}

async function ReadDirectoryEntry(entry, parentPath, entries)
{
    const entryPath = parentPath + entry.name;
    if (entry.isFile)
    {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        entries.push({ file, path: entryPath });
        return;
    }
    entries.push({ file: null, path: entryPath + '/' });
    const reader = entry.createReader();
    // Chromium returns directory contents in batches, often only 100 entries at a time.
    while (true)
    {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0)
        {
            break;
        }
        for (const child of batch)
        {
            await ReadDirectoryEntry(child, entryPath + '/', entries);
        }
    }
}

async function CreateUploadFile(entries, onProgress, signal)
{
    if (entries.length === 1 && entries[0].file && entries[0].path === entries[0].file.name)
    {
        return entries[0].file;
    }

    const writer = new zip.ZipWriter(new zip.BlobWriter('application/zip'));
    const totalBytes = entries.reduce((size, entry) => size + (entry.file?.size || 0), 0);
    let completedBytes = 0;
    for (const entry of entries)
    {
        signal?.throwIfAborted();
        const segments = entry.path.replace(/\/$/, '').split('/');
        if (entry.path.includes('\\') || segments.some(segment => !segment || segment === '.' || segment === '..'))
        {
            throw new Error(`Cannot archive this path: ${entry.path}`);
        }
        await writer.add(entry.path, entry.file ? new zip.BlobReader(entry.file) : undefined, {
            signal,
            directory: !entry.file,
            lastModDate: entry.file ? new Date(entry.file.lastModified) : undefined,
            onprogress: loaded => onProgress(totalBytes > 0 ? (completedBytes + loaded) / totalBytes * 100 : 100)
        });
        completedBytes += entry.file?.size || 0;
    }
    const archive = await writer.close();
    signal?.throwIfAborted();
    const root = entries[0].path.split('/')[0];
    const folder = entries.every(entry => entry.path.startsWith(root + '/'));
    return new File([archive], folder ? `${root}.zip` : 'files.zip', { type: 'application/zip' });
}
