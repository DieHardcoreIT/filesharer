import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import ejs from 'ejs';
import * as zip from '@zip.js/zip.js';

zip.configure({ useWebWorkers: false });

function CreateDocument()
{
    const elements = new Map();
    const document = {
        addEventListener: (event, handler) => (document[event] = handler),
        getElementById: (id) =>
        {
            if (!elements.has(id))
            {
                const listeners = new Map();
                const element = {
                    textContent: '',
                    files: [],
                    children: [],
                    style: {},
                    setAttribute: (name, value) => element[name] = value,
                    focus: () => document.activeElement = element,
                    replaceChildren: (...children) => element.children = children,
                    append: child => element.children.push(child),
                    classList: {
                        add()
                        {
                        },
                        remove()
                        {
                        }
                    },
                    addEventListener: (event, handler) =>
                    {
                        const handlers = listeners.get(event) || [];
                        handlers.push(handler);
                        listeners.set(event, handlers);
                    },
                    dispatchEvent: async event =>
                    {
                        for (const handler of listeners.get(event.type) || [])
                        {
                            await handler(event);
                        }
                    },
                    click: () => element.dispatchEvent({ type: 'click' })
                };
                elements.set(id, element);
            }
            return elements.get(id);
        },
        querySelector: (selector) => document.getElementById(selector),
        createElement: () => ({ textContent: '' }),
        querySelectorAll: () => []
    };
    return document;
}

test('browse button opens the file picker once', async () =>
{
    const document = CreateDocument();
    let clicks = 0;
    document.getElementById('fileInput').click = () => clicks++;
    const source = await readFile(path.join(import.meta.dirname, '../public/js/dashboard.js'), 'utf8');
    vm.runInNewContext(source, { document });
    document.DOMContentLoaded();
    await document.querySelector('.browse-btn').click();
    assert.equal(clicks, 1);
});

test('multiple selected files and a picked folder become one ZIP with relative paths', async () =>
{
    const document = CreateDocument();
    document.querySelector('.tab.active').getAttribute = () => 'file';
    const first = new File(['First file'], 'one.txt');
    const second = new File(['Second file'], 'two.txt');
    const nested = new File(['Nested file'], 'one.txt');
    Object.defineProperty(nested, 'webkitRelativePath', { value: 'Project/sub/one.txt' });
    const context = vm.createContext({ document, zip, File, Date, AbortController });
    vm.runInContext(await readFile(path.join(import.meta.dirname, '../public/js/file-selection.js'), 'utf8'), context);
    vm.runInContext(await readFile(path.join(import.meta.dirname, '../public/js/dashboard.js'), 'utf8'), context);
    let uploaded;
    context.UploadFile = async file => uploaded = file;
    document.DOMContentLoaded();
    const input = document.getElementById('fileInput');
    input.files = [first, second];
    await input.dispatchEvent({ type: 'change' });
    const folderInput = document.getElementById('folderInput');
    folderInput.files = [nested];
    await folderInput.dispatchEvent({ type: 'change' });
    assert.match(document.getElementById('file-name').textContent, /3 files/);
    await document.querySelector('.upload-btn').click();
    assert.equal(uploaded.name, 'files.zip');

    const reader = new zip.ZipReader(new zip.BlobReader(uploaded));
    const entries = await reader.getEntries();
    assert.deepEqual(entries.map(entry => entry.filename), ['one.txt', 'two.txt', 'Project/sub/one.txt']);
    assert.equal(await entries[2].getData(new zip.TextWriter()), 'Nested file');
    assert.equal(await entries[0].getData(new zip.TextWriter()), 'First file');
    await reader.close();
    await document.getElementById('remove-file').click();
    assert.equal(document.getElementById('file-preview').style.display, 'none');
});

test('dropped folders read every directory batch and preserve nested and empty folders in ZIPs', async () =>
{
    const file = new File(['Folder data'], 'data.txt');
    const empty = { name: 'empty', createReader: () => ({ readEntries: resolve => resolve([]) }) };
    const fileEntry = { name: file.name, isFile: true, file: resolve => resolve(file) };
    let batch = 0;
    const folder = {
        name: 'Project',
        createReader: () => ({ readEntries: resolve => resolve([[fileEntry], [empty], []][batch++]) })
    };
    const context = vm.createContext({ zip, File, Date });
    vm.runInContext(await readFile(path.join(import.meta.dirname, '../public/js/file-selection.js'), 'utf8'), context);
    const selected = await context.ReadDroppedEntries({ items: [{ webkitGetAsEntry: () => folder }] });
    assert.equal(batch, 3);
    const archive = await context.CreateUploadFile(selected, () => {});
    assert.equal(archive.name, 'Project.zip');
    const reader = new zip.ZipReader(new zip.BlobReader(archive));
    const entries = await reader.getEntries();
    assert.deepEqual(entries.map(entry => entry.filename), ['Project/', 'Project/data.txt', 'Project/empty/']);
    assert.equal(entries[2].directory, true);
    assert.equal(await entries[1].getData(new zip.TextWriter()), 'Folder data');
    await reader.close();

    // A single file remains a direct download, including when selected through drag-and-drop.
    const direct = await context.ReadDroppedEntries({ files: [file] });
    assert.equal(await context.CreateUploadFile(direct, () => {}), file);
});

test('shared text and links copy their displayed content', async () =>
{
    for (const contentType of ['text', 'link'])
    {
        const document = CreateDocument();
        const getElementById = document.getElementById;
        document.getElementById = (id) =>
            id === (contentType === 'text' ? 'linkContent' : 'textContent') ? null : getElementById(id);
        const content = contentType === 'link' ? 'https://example.com' : 'Shared text';
        document.getElementById(contentType === 'link' ? 'linkContent' : 'textContent').textContent = content;
        let copied;
        const html = await ejs.renderFile(path.join(import.meta.dirname, '../views/shared-content.ejs'), {
            content,
            contentType,
            AssetUrl: assetPath => assetPath
        });
        assert.match(html, /src="\/js\/shared-content.js"/);
        const source = await readFile(path.join(import.meta.dirname, '../public/js/clipboard.js'), 'utf8') + '\n' +
            await readFile(path.join(import.meta.dirname, '../public/js/shared-content.js'), 'utf8');
        vm.runInNewContext(source, {
            document,
            navigator: { clipboard: { writeText: async (value) => (copied = value) } },
            setTimeout: () =>
            {
            },
            console,
            alert: (message) => assert.fail(message)
        });
        document.DOMContentLoaded();
        await document.getElementById('copyBtn').click();
        assert.equal(copied, content);
        assert.equal(document.getElementById('copyText').textContent, 'Copied!');
    }
});

test('copying falls back when the Clipboard API is absent or rejects access', async () =>
{
    const source = await readFile(path.join(import.meta.dirname, '../public/js/clipboard.js'), 'utf8');
    const deniedClipboard = {
        writeText: async () =>
        {
            throw new Error('NotAllowedError');
        }
    };
    for (const clipboard of [undefined, deniedClipboard])
    {
        let input;
        let copied;
        let removed = false;
        let restored = false;
        const document = {
            activeElement: { focus: () => restored = true },
            body: { append: element => input = element },
            createElement: () => ({
                style: {},
                focus()
                {
                },
                select()
                {
                },
                remove: () => removed = true
            }),
            execCommand: command =>
            {
                assert.equal(command, 'copy');
                copied = input.value;
                return true;
            }
        };
        const context = vm.createContext({ document, navigator: { clipboard } });
        vm.runInContext(source, context);
        const text = 'First line\nhttps://example.com/?a=1&b=2\nGrüsse';
        await context.CopyText(text);
        assert.equal(copied, text);
        assert.equal(removed, true);
        assert.equal(restored, true);
    }
});

test('a rejected fallback copy reports failure and removes the temporary input', async () =>
{
    let removed = false;
    const document = {
        body: {
            append()
            {
            }
        },
        createElement: () => ({
            style: {},
            focus()
            {
            },
            select()
            {
            },
            remove: () => removed = true
        }),
        execCommand: () => false
    };
    const context = vm.createContext({ document, navigator: {} });
    vm.runInContext(await readFile(path.join(import.meta.dirname, '../public/js/clipboard.js'), 'utf8'), context);
    await assert.rejects(context.CopyText('Shared text'), /Could not copy automatically/);
    assert.equal(removed, true);
});

test('browser splits a file above 100 MB into 8 MiB requests and retries an interrupted chunk', async () =>
{
    const document = CreateDocument();
    document.querySelector('input[name="expiration"]:checked').value = '1h';
    const chunkSize = 8 * 1024 * 1024;
    const fileSize = 104 * 1024 * 1024 + 17;
    const requests = [];
    const sentChunks = [];
    let interrupted = false;
    let saved;
    const window = { location: { href: '' } };
    class ChunkRequest
    {
        constructor()
        {
            this.upload = {};
        }

        open(method, url)
        {
            assert.equal(method, 'POST');
            assert.equal(url, '/upload/chunk');
        }

        send(form)
        {
            const chunk = form.get('chunk');
            assert.equal(form.get('uploadId'), 'browser-upload');
            assert.ok(chunk.size <= chunkSize);
            if (!interrupted)
            {
                interrupted = true;
                this.onerror();
                return;
            }
            sentChunks.push({ number: Number(form.get('chunkNumber')), size: chunk.size });
            this.upload.onprogress({ lengthComputable: true, loaded: chunk.size + 400, total: chunk.size + 400 });
            this.status = 200;
            this.responseText = '{"success":true}';
            this.onload();
        }
    }
    const source = await readFile(path.join(import.meta.dirname, '../public/js/dashboard.js'), 'utf8');
    const context = vm.createContext({
        document, window, FormData, XMLHttpRequest: ChunkRequest, performance,
        sessionStorage: { setItem: (key, value) => saved = JSON.parse(value) },
        setTimeout: callback => callback(),
        alert: message => assert.fail(message),
        console,
        fetch: async (url, options) =>
        {
            const body = JSON.parse(options.body);
            requests.push(url);
            if (url === '/upload/initiate')
            {
                assert.equal(body.fileSize, fileSize);
                return { ok: true, json: async () => ({ success: true, uploadId: 'browser-upload', chunkSize }) };
            }
            assert.equal(url, '/upload/finalize');
            assert.equal(body.totalChunks, 14);
            assert.equal(body.uploadId, 'browser-upload');
            return { ok: true, json: async () => ({ success: true, link: '/d/browser-file' }) };
        }
    });
    vm.runInContext(source, context);
    await context.UploadFile({
        name: 'large.bin', size: fileSize,
        slice: (start, end) => new Blob([new Uint8Array(end - start)])
    });
    assert.deepEqual(requests, ['/upload/initiate', '/upload/finalize']);
    assert.deepEqual(sentChunks.map(chunk => chunk.number), Array.from({ length: 14 }, (_, index) => index + 1));
    assert.equal(sentChunks.reduce((size, chunk) => size + chunk.size, 0), fileSize);
    assert.equal(sentChunks.at(-1).size, 17);
    assert.equal(saved.link, '/d/browser-file');
    assert.equal(window.location.href, '/upload-success');
    assert.equal(document.querySelector('.upload-btn').disabled, false);
});


test('sign-in connection errors keep the entered password and allow retrying', async () =>
{
    const document = CreateDocument();
    const password = document.getElementById('password');
    password.value = 'unchanged password';
    const context = vm.createContext({
        document,
        fetch: async () =>
        {
            throw new Error('Connection interrupted');
        }
    });
    vm.runInContext(await readFile(path.join(import.meta.dirname, '../public/js/index.js'), 'utf8'), context);
    document.DOMContentLoaded();
    await document.getElementById('loginForm').dispatchEvent({
        type: 'submit',
        preventDefault()
        {
        }
    });
    assert.equal(password.value, 'unchanged password');
    assert.match(document.getElementById('loginError').textContent, /Could not connect/);
    assert.equal(document.getElementById('submitPassword').disabled, false);
});

test('cancelling a chunk upload removes its session without retrying or finalizing', async () =>
{
    const document = CreateDocument();
    const controller = new AbortController();
    const requests = [];
    class CancelledRequest
    {
        constructor()
        {
            this.upload = {};
        }

        open()
        {
        }

        send()
        {
            controller.abort();
        }

        abort()
        {
            this.onabort();
            this.onloadend();
        }
    }
    const context = vm.createContext({
        document, FormData, DOMException, performance, console,
        XMLHttpRequest: CancelledRequest,
        fetch: async (url, options) =>
        {
            requests.push({ url, method: options.method });
            return { ok: true, json: async () => ({ success: true, uploadId: 'cancelled', chunkSize: 8 * 1024 * 1024 }) };
        }
    });
    vm.runInContext(await readFile(path.join(import.meta.dirname, '../public/js/dashboard.js'), 'utf8'), context);
    await assert.rejects(context.UploadFile(new File(['test'], 'test.txt'), controller.signal), error => error.name === 'AbortError');
    assert.deepEqual(requests, [
        { url: '/upload/initiate', method: 'POST' },
        { url: '/upload/cancelled', method: 'DELETE' }
    ]);
    assert.equal(document.querySelector('.upload-btn').disabled, false);
});
