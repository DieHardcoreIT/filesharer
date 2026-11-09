document.addEventListener('DOMContentLoaded', function ()
{
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.upload-content');

    tabs.forEach((tab) =>
    {
        tab.addEventListener('click', () =>
        {
            if (uploadBtn.disabled)
            {
                return;
            }
            tabs.forEach((t) =>
            {
                t.classList.remove('active');
                t.setAttribute('aria-pressed', 'false');
            });
            contents.forEach((c) => c.classList.remove('active'));

            tab.classList.add('active');
            tab.setAttribute('aria-pressed', 'true');

            const tabType = tab.getAttribute('data-tab');
            document.getElementById(`${tabType}-content`).classList.add('active');
        });
    });

    const fileInput = document.getElementById('fileInput');
    const browseBtn = document.querySelector('.browse-btn');
    const folderInput = document.getElementById('folderInput');
    const folderBtn = document.getElementById('browseFolder');
    const fileError = document.getElementById('file-error');
    let selectedEntries = [];
    let busy = false;
    let operationController;
    const cancelButton = document.getElementById('cancelUpload');
    cancelButton.addEventListener('click', () => operationController?.abort());

    const uploadBtn = document.querySelector('.upload-btn');
    uploadBtn.addEventListener('click', async () =>
    {
        document.getElementById('shareError').textContent = '';
        const activeTab = document.querySelector('.tab.active').getAttribute('data-tab');

        if (activeTab === 'file')
        {
            if (selectedEntries.length === 0)
            {
                fileError.textContent = 'Please select files or a folder.';
                return;
            }

            busy = true;
            operationController = new AbortController();
            cancelButton.hidden = false;
            cancelButton.disabled = false;
            fileError.textContent = '';
            uploadBtn.disabled = true;
            for (const control of [fileInput, folderInput, browseBtn, folderBtn, removeFileBtn])
            {
                control.disabled = true;
            }
            try
            {
                uploadBtn.textContent = 'Preparing share...';
                SetUploadStatus('Preparing files...');
                const file = await CreateUploadFile(selectedEntries, percent =>
                {
                    SetUploadStatus(`Creating ZIP · ${percent.toFixed(0)}%`, percent);
                }, operationController.signal);
                await UploadFile(file, operationController.signal);
            }
            catch (error)
            {
                if (operationController.signal.aborted)
                {
                    SetUploadStatus('Upload cancelled. Your selection is still available.');
                }
                else
                {
                    fileError.textContent = error.message || 'Could not prepare this share. Please try again.';
                    document.getElementById('uploadFeedback').hidden = true;
                }
            }
            finally
            {
                busy = false;
                operationController = null;
                cancelButton.hidden = true;
                uploadBtn.disabled = false;
                uploadBtn.textContent = 'Create share link';
                for (const control of [fileInput, folderInput, browseBtn, folderBtn, removeFileBtn])
                {
                    control.disabled = false;
                }
            }
        }
        else if (activeTab === 'text')
        {
            const textContent = document.getElementById('textContent').value;
            if (!textContent.trim())
            {
                document.getElementById('shareError').textContent = 'Enter some text to share.';
                return;
            }

            await UploadContent(textContent, 'text');
        }
        else if (activeTab === 'link')
        {
            const linkContent = document.getElementById('linkContent').value;
            if (!linkContent.trim())
            {
                document.getElementById('shareError').textContent = 'Enter a link to share.';
                return;
            }

            await UploadContent(linkContent, 'link');
        }
    });

    const uploadArea = document.getElementById('upload-area');
    const filePreview = document.getElementById('file-preview');
    const fileName = document.getElementById('file-name');
    const fileSize = document.getElementById('file-size');
    const removeFileBtn = document.getElementById('remove-file');
    const fileList = document.getElementById('file-list');

    browseBtn.addEventListener('click', () => fileInput.click());

    folderBtn.addEventListener('click', () => folderInput.click());
    for (const input of [fileInput, folderInput])
    {
        input.addEventListener('change', () =>
        {
            if (!busy && input.files.length > 0)
            {
                AddEntries(Array.from(input.files, file => ({ file, path: file.webkitRelativePath || file.name })));
            }
            input.value = '';
        });
    }

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) =>
    {
        uploadArea.addEventListener(eventName, PreventDefaults, false);
    });

    function PreventDefaults(e)
    {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach((eventName) =>
    {
        uploadArea.addEventListener(eventName, Highlight, false);
    });

    ['dragleave', 'drop'].forEach((eventName) =>
    {
        uploadArea.addEventListener(eventName, Unhighlight, false);
    });

    function Highlight()
    {
        uploadArea.style.borderColor = 'var(--accent)';
        uploadArea.style.backgroundColor = 'var(--tint)';
    }

    function Unhighlight()
    {
        uploadArea.style.borderColor = '';
        uploadArea.style.backgroundColor = '';
    }

    uploadArea.addEventListener('drop', async (event) =>
    {
        if (busy)
        {
            return;
        }
        busy = true;
        uploadBtn.disabled = true;
        fileError.textContent = '';
        SetUploadStatus('Reading files and folders...');
        for (const control of [fileInput, folderInput, browseBtn, folderBtn, removeFileBtn])
        {
            control.disabled = true;
        }
        try
        {
            AddEntries(await ReadDroppedEntries(event.dataTransfer));
        }
        catch (error)
        {
            fileError.textContent = 'Could not read the selection. Please use Browse Files or Choose Folder.';
        }
        finally
        {
            busy = false;
            uploadBtn.disabled = false;
            document.getElementById('uploadFeedback').hidden = true;
            for (const control of [fileInput, folderInput, browseBtn, folderBtn, removeFileBtn])
            {
                control.disabled = false;
            }
        }
    });

    function AddEntries(entries)
    {
        if (entries.length === 0)
        {
            fileError.textContent = 'No files or folders were found in this selection.';
            return;
        }
        const paths = new Set(selectedEntries.map(entry => entry.path));
        for (const entry of entries)
        {
            if (paths.has(entry.path))
            {
                fileError.textContent = `Already selected: ${entry.path}. Rename it or clear the selection first.`;
                return;
            }
            paths.add(entry.path);
        }
        selectedEntries = selectedEntries.concat(entries);
        const files = selectedEntries.filter(entry => entry.file);
        const singleFile = selectedEntries.length === 1 && selectedEntries[0].path === selectedEntries[0].file?.name;
        fileName.textContent = singleFile ? files[0].file.name : `${files.length} ${files.length === 1 ? 'file' : 'files'} · ZIP archive`;
        fileSize.textContent = FormatBytes(files.reduce((size, entry) => size + entry.file.size, 0)) + (singleFile ? '' : ' before compression');
        fileList.replaceChildren();
        for (const entry of selectedEntries.slice(0, 10))
        {
            const item = document.createElement('li');
            item.textContent = entry.path;
            fileList.append(item);
        }
        if (selectedEntries.length > 10)
        {
            const item = document.createElement('li');
            item.textContent = `+ ${selectedEntries.length - 10} more`;
            fileList.append(item);
        }
        filePreview.style.display = 'flex';
        fileError.textContent = '';
    }

    removeFileBtn.addEventListener('click', () =>
    {
        selectedEntries = [];
        fileInput.value = '';
        folderInput.value = '';
        fileList.replaceChildren();
        filePreview.style.display = 'none';
        fileError.textContent = '';
    });
});

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

function FormatEta(totalSeconds)
{
    if (totalSeconds === Infinity || isNaN(totalSeconds) || totalSeconds < 0)
    {
        return 'Calculating...';
    }
    if (totalSeconds < 1)
    {
        return '< 1 sec';
    }
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    let etaString = '';
    if (hours > 0)
    {
        etaString += `${hours}h `;
    }
    if (minutes > 0 || hours > 0)
    {
        etaString += `${minutes}m `;
    }
    etaString += `${seconds}s`;
    return etaString.trim();
}

async function UploadContent(content, contentType)
{
    const uploadButton = document.querySelector('.upload-btn');

    uploadButton.disabled = true;
    uploadButton.textContent = 'Uploading...';

    const expiration = document.querySelector('input[name="expiration"]:checked').value;

    try
    {
        const response = await fetch('/share-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content,
                contentType,
                expiry: expiration
            })
        });

        const data = await response.json();
        if (response.ok && data.success)
        {
            sessionStorage.setItem('uploadSuccessData', JSON.stringify(data));
            window.location.href = '/upload-success';
        }
        else
        {
            document.getElementById('shareError').textContent = data.error || 'Sharing failed. Please try again.';
        }
    }
    catch (error)
    {
        console.error('Sharing error:', error);
        document.getElementById('shareError').textContent = 'Could not connect. Your content has been kept; please try again.';
    }
    finally
    {
        uploadButton.disabled = false;
        uploadButton.textContent = 'Create share link';
    }
}

async function SendUploadRequest(url, body, signal)
{
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
    });
    const data = await response.json();
    if (!response.ok || !data.success)
    {
        throw new Error(data.error || `Upload failed (${response.status}).`);
    }
    return data;
}

function UploadChunk(uploadId, chunkNumber, chunk, onProgress, signal)
{
    signal?.throwIfAborted();
    return new Promise((resolve, reject) =>
    {
        const formData = new FormData();
        formData.append('uploadId', uploadId);
        formData.append('chunkNumber', String(chunkNumber));
        formData.append('chunk', chunk, 'chunk.bin');
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload/chunk');
        xhr.timeout = 5 * 60 * 1000;
        const Abort = () => xhr.abort();
        signal?.addEventListener('abort', Abort, { once: true });
        xhr.onloadend = () => signal?.removeEventListener('abort', Abort);
        xhr.onabort = () => reject(new DOMException('Upload cancelled.', 'AbortError'));
        xhr.upload.onprogress = (event) =>
        {
            if (event.lengthComputable)
            {
                onProgress(chunk.size * event.loaded / event.total);
            }
        };
        xhr.onload = () =>
        {
            let data;
            try
            {
                data = JSON.parse(xhr.responseText);
            }
            catch
            {
                data = { error: `Upload failed (${xhr.status}).` };
            }
            if (xhr.status >= 200 && xhr.status < 300 && data.success)
            {
                resolve();
                return;
            }
            const error = new Error(data.error || `Upload failed (${xhr.status}).`);
            error.status = xhr.status;
            reject(error);
        };
        xhr.onerror = xhr.ontimeout = () =>
        {
            const error = new Error('The upload connection was interrupted. Please try again.');
            error.status = 0;
            reject(error);
        };
        xhr.send(formData);
    });
}

async function UploadFile(file, signal)
{
    const uploadButton = document.querySelector('.upload-btn');
    uploadButton.disabled = true;
    uploadButton.textContent = 'Uploading...';
    SetUploadStatus('Starting upload...');
    let uploadId;

    try
    {
        const session = await SendUploadRequest('/upload/initiate', {
            fileName: file.name,
            fileSize: file.size,
            expiry: document.querySelector('input[name="expiration"]:checked').value
        }, signal);
        uploadId = session.uploadId;
        const totalChunks = Math.max(1, Math.ceil(file.size / session.chunkSize));
        const startedAt = performance.now();
        for (let number = 1; number <= totalChunks; number++)
        {
            signal?.throwIfAborted();
            const offset = (number - 1) * session.chunkSize;
            const chunk = file.slice(offset, Math.min(offset + session.chunkSize, file.size));
            for (let attempt = 1; ; attempt++)
            {
                try
                {
                    await UploadChunk(uploadId, number, chunk, (loaded) =>
                    {
                        const uploaded = offset + loaded;
                        const seconds = (performance.now() - startedAt) / 1000;
                        const speed = seconds > 0 ? uploaded / seconds : 0;
                        const percent = file.size > 0 ? uploaded / file.size * 100 : 100;
                        const eta = speed > 0 ? FormatEta((file.size - uploaded) / speed) : 'Calculating...';
                        SetUploadStatus(`${FormatBytes(uploaded)} of ${FormatBytes(file.size)} · ${FormatBytes(speed)}/s · ${eta} remaining`, percent);
                    }, signal);
                    break;
                }
                catch (error)
                {
                    if (error.name === 'AbortError' || attempt >= 3 || (error.status !== 0 && error.status !== 429 && error.status < 500))
                    {
                        throw error;
                    }
                    SetUploadStatus('Connection interrupted. Retrying...');
                    await new Promise(resolve => setTimeout(resolve, attempt * 500));
                }
            }
        }
        signal?.throwIfAborted();
        // Finalization publishes the link; let it finish before offering another action.
        document.getElementById('cancelUpload').disabled = true;
        uploadButton.textContent = 'Preparing link...';
        SetUploadStatus('Preparing your sharing link...');
        const result = await SendUploadRequest('/upload/finalize', { uploadId, totalChunks });
        sessionStorage.setItem('uploadSuccessData', JSON.stringify(result));
        window.location.href = '/upload-success';
    }
    catch (error)
    {
        if (uploadId)
        {
            await fetch(`/upload/${uploadId}`, { method: 'DELETE' }).catch(cleanupError =>
            {
                console.error('Could not cancel upload:', cleanupError);
            });
        }
        if (error.name !== 'AbortError')
        {
            console.error('Upload failed:', error);
        }
        throw error;
    }
    finally
    {
        uploadButton.disabled = false;
        uploadButton.textContent = 'Create share link';
    }
}

function SetUploadStatus(message, percent)
{
    document.getElementById('uploadFeedback').hidden = false;
    document.getElementById('uploadStatus').textContent = message;
    const progress = document.getElementById('uploadProgress');
    progress.hidden = percent === undefined;
    if (percent !== undefined)
    {
        progress.value = percent;
    }
}
