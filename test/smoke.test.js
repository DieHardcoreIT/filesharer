import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmod, cp, mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { HashPassword } from '../authentication.js';

test('login, templates, file upload, text sharing and chunk uploads work', { timeout: 30000 }, async () =>
{
    const projectDir = path.resolve(import.meta.dirname, '..');
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'filesharer-test-'));
    let child;
    let output = '';

    try
    {
        for (const name of ['server.js', 'authentication.js', 'fileStorage.js', 'sharing.js', 'uploadRoutes.js', 'banManager.js', 'package.json', 'views', 'public'])
        {
            await cp(path.join(projectDir, name), path.join(tempDir, name), { recursive: true });
        }
        // Docker assets are read-only; the temporary copies must allow cleanup on Linux.
        for (const name of ['public', 'public/css', 'public/js', 'views'])
        {
            await chmod(path.join(tempDir, name), 0o700);
        }
        await symlink(path.join(projectDir, 'node_modules'), path.join(tempDir, 'node_modules'), 'junction');

        const staleUpload = path.join(tempDir, 'tmp_chunks', 'abandoned-session');
        await mkdir(staleUpload, { recursive: true });
        await writeFile(path.join(staleUpload, 'chunk-1'), 'abandoned data');
        const expiredAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
        await utimes(staleUpload, expiredAt, expiredAt);

        const listener = net.createServer();
        listener.listen(0, '127.0.0.1');
        await once(listener, 'listening');
        const port = listener.address().port;
        await new Promise((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));

        const passwordHash = await HashPassword('smoke-secret');
        const childEnv = { ...process.env, PORT: String(port), APP_UPLOAD_PASSWORD_HASH: passwordHash, MAX_FILE_SIZE: '128' };
        delete childEnv.APP_UPLOAD_PASSWORD;
        child = spawn(process.execPath, ['server.js'], {
            cwd: tempDir,
            env: childEnv,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        child.stderr.on('data', (data) =>
        {
            output += data;
        });
        await new Promise((resolve, reject) =>
        {
            const timer = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 10000);
            child.once('error', (error) =>
            {
                clearTimeout(timer);
                reject(error);
            });
            child.once('exit', (code) =>
            {
                clearTimeout(timer);
                reject(new Error(`Server exited (${code}): ${output}`));
            });
            child.stdout.on('data', (data) =>
            {
                output += data;
                if (output.includes('FileSharer läuft'))
                {
                    clearTimeout(timer);
                    resolve();
                }
            });
        });

        const baseUrl = `http://127.0.0.1:${port}`;
        const zipLibrary = await fetch(`${baseUrl}/vendor/zip.min.js`);
        assert.equal(zipLibrary.status, 200);
        assert.match(zipLibrary.headers.get('content-type'), /javascript/);
        assert.deepEqual(await readdir(path.join(tempDir, 'tmp_chunks')), []);
        assert.equal((await fetch(baseUrl)).status, 200);
        for (const invalidCookie of ['login=smoke-secret', 'login=forged', `session=${passwordHash}`, `session=${'a'.repeat(64)}`])
        {
            const headers = { Cookie: invalidCookie, 'Content-Type': 'application/json' };
            assert.doesNotMatch(await (await fetch(`${baseUrl}/dashboard`, { headers })).text(), /Storage Usage/);
            assert.equal((await fetch(`${baseUrl}/share-text`, { method: 'POST', headers, body: '{}' })).status, 403);
            assert.equal((await fetch(`${baseUrl}/upload/initiate`, { method: 'POST', headers, body: '{}' })).status, 403);
        }
        for (const password of ['wrong-secret', passwordHash, { value: 'smoke-secret' }])
        {
            assert.equal((await fetch(`${baseUrl}/verify-password`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password })
            })).status, 401);
        }
        assert.equal((await fetch(`${baseUrl}/api/v1/upload/initiate`, {
            method: 'POST', headers: { Authorization: `Bearer ${passwordHash}`, 'Content-Type': 'application/json' }, body: '{}'
        })).status, 401);
        const login = await fetch(`${baseUrl}/verify-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'smoke-secret' })
        });
        assert.equal(login.status, 200);
        const sessionCookie = login.headers.getSetCookie().find(value => value.startsWith('session='));
        assert.match(sessionCookie, /HttpOnly/);
        assert.match(sessionCookie, /SameSite=Lax/);
        assert.doesNotMatch(sessionCookie, /smoke-secret|scrypt-v1/);
        const cookie = sessionCookie.split(';')[0];
        const dashboard = await fetch(`${baseUrl}/dashboard`, { headers: { Cookie: cookie } });
        assert.equal(dashboard.status, 200);
        const dashboardHtml = await dashboard.text();
        assert.match(dashboardHtml, /Storage Usage/);
        assert.equal(dashboard.headers.get('cache-control'), 'no-store');
        const scripts = [...dashboardHtml.matchAll(/src="([^"]+)"/g)].map(match => match[1]);
        assert.equal(scripts.length, 3);
        for (const script of scripts)
        {
            assert.match(script, /\?v=[a-f0-9]{16}$/);
            const asset = await fetch(baseUrl + script);
            assert.equal(asset.status, 200);
            const bytes = Buffer.from(await asset.arrayBuffer());
            assert.equal(new URL(baseUrl + script).searchParams.get('v'),
                createHash('sha256').update(bytes).digest('hex').slice(0, 16));
        }

        const browserHeaders = { Cookie: cookie, 'Content-Type': 'application/json' };
        const firstChunk = Buffer.alloc(8 * 1024 * 1024, 65);
        const lastChunk = Buffer.from('last chunk bytes');
        const browserInitiate = await fetch(`${baseUrl}/upload/initiate`, {
            method: 'POST', headers: browserHeaders,
            body: JSON.stringify({ fileName: 'browser.bin', fileSize: 13 * firstChunk.length + lastChunk.length })
        });
        assert.equal(browserInitiate.status, 200);
        const browserSession = await browserInitiate.json();
        assert.equal(browserSession.chunkSize, firstChunk.length);
        const oversizedChunk = new FormData();
        oversizedChunk.append('uploadId', browserSession.uploadId);
        oversizedChunk.append('chunkNumber', '1');
        oversizedChunk.append('chunk', new Blob([firstChunk, 'x']), 'chunk.bin');
        assert.equal((await fetch(`${baseUrl}/upload/chunk`, {
            method: 'POST', headers: { Cookie: cookie }, body: oversizedChunk
        })).status, 413);
        const invalidChunk = new FormData();
        invalidChunk.append('uploadId', browserSession.uploadId);
        invalidChunk.append('chunkNumber', '../1');
        invalidChunk.append('chunk', new Blob([lastChunk]), 'chunk.bin');
        assert.equal((await fetch(`${baseUrl}/upload/chunk`, {
            method: 'POST', headers: { Cookie: cookie }, body: invalidChunk
        })).status, 400);

        // Repeat the first chunk to cover a retry after a lost acknowledgement.
        for (const number of [1, ...Array.from({ length: 14 }, (_, index) => index + 1)])
        {
            const form = new FormData();
            form.append('uploadId', browserSession.uploadId);
            form.append('chunkNumber', String(number));
            form.append('chunk', new Blob([number <= 13 ? firstChunk : lastChunk]), 'chunk.bin');
            const response = await fetch(`${baseUrl}/upload/chunk`, {
                method: 'POST', headers: { Cookie: cookie }, body: form
            });
            assert.equal(response.status, 200, await response.text());
        }
        const browserFinalize = await fetch(`${baseUrl}/upload/finalize`, {
            method: 'POST', headers: browserHeaders,
            body: JSON.stringify({ uploadId: browserSession.uploadId, totalChunks: 14 })
        });
        assert.equal(browserFinalize.status, 200, await browserFinalize.clone().text());
        const uploaded = await browserFinalize.json();
        const download = await fetch(uploaded.link);
        const downloadedHash = createHash('sha256');
        let downloadedSize = 0;
        for await (const bytes of download.body)
        {
            downloadedHash.update(bytes);
            downloadedSize += bytes.length;
        }
        const expectedHash = createHash('sha256');
        for (let number = 1; number <= 13; number++)
        {
            expectedHash.update(firstChunk);
        }
        expectedHash.update(lastChunk);
        assert.equal(downloadedSize, 13 * firstChunk.length + lastChunk.length);
        assert.equal(downloadedHash.digest('hex'), expectedHash.digest('hex'));
        assert.deepEqual(await readdir(path.join(tempDir, 'tmp_chunks')), []);

        const tooLarge = await fetch(`${baseUrl}/upload/initiate`, {
            method: 'POST', headers: browserHeaders,
            body: JSON.stringify({ fileName: 'too-large.bin', fileSize: 128 * 1024 * 1024 + 1 })
        });
        assert.equal(tooLarge.status, 413);
        const unauthorized = await fetch(`${baseUrl}/upload/initiate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: 'unauthorized.bin', fileSize: 1 })
        });
        assert.equal(unauthorized.status, 403);

        const share = await fetch(`${baseUrl}/share-text`, {
            method: 'POST',
            headers: { Cookie: cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: 'Smoke test text', contentType: 'text' })
        });
        assert.equal(share.status, 200);
        const shared = await share.json();
        const content = await fetch(shared.link);
        assert.equal(content.status, 200);
        assert.match(await content.text(), /Smoke test text/);

        const apiHeaders = { Authorization: 'Bearer smoke-secret', 'Content-Type': 'application/json' };
        const initiate = await fetch(`${baseUrl}/api/v1/upload/initiate`, {
            method: 'POST',
            headers: apiHeaders,
            body: JSON.stringify({
                fileName: 'chunked.txt',
                fileSize: 5,
                fileHash: createHash('sha256').update('chunk').digest('hex')
            })
        });
        assert.equal(initiate.status, 200);
        const { uploadId } = await initiate.json();
        assert.match(uploadId, /^[0-9a-f-]{36}$/);
        const chunkForm = new FormData();
        chunkForm.append('uploadId', uploadId);
        chunkForm.append('chunkNumber', '1');
        chunkForm.append('chunk', new Blob(['chunk']), 'chunk.bin');
        const chunk = await fetch(`${baseUrl}/api/v1/upload/chunk`, {
            method: 'POST',
            headers: { Authorization: 'Bearer smoke-secret' },
            body: chunkForm
        });
        assert.equal(chunk.status, 200);
        const finalize = await fetch(`${baseUrl}/api/v1/upload/finalize`, {
            method: 'POST',
            headers: apiHeaders,
            body: JSON.stringify({ uploadId, totalChunks: 1 })
        });
        assert.equal(finalize.status, 200);
        const finalized = await finalize.json();
        assert.equal(await (await fetch(finalized.link)).text(), 'chunk');

        const corruptInitiate = await fetch(`${baseUrl}/api/v1/upload/initiate`, {
            method: 'POST', headers: apiHeaders,
            body: JSON.stringify({ fileName: 'corrupt.txt', fileSize: 1, fileHash: '0'.repeat(64) })
        });
        const corruptSession = await corruptInitiate.json();
        const corruptForm = new FormData();
        corruptForm.append('uploadId', corruptSession.uploadId);
        corruptForm.append('chunkNumber', '1');
        corruptForm.append('chunk', new Blob(['x']), 'chunk.bin');
        assert.equal((await fetch(`${baseUrl}/api/v1/upload/chunk`, {
            method: 'POST', headers: { Authorization: 'Bearer smoke-secret' }, body: corruptForm
        })).status, 200);
        const filesBefore = await readdir(path.join(tempDir, 'uploads'));
        assert.equal((await fetch(`${baseUrl}/api/v1/upload/finalize`, {
            method: 'POST', headers: apiHeaders,
            body: JSON.stringify({ uploadId: corruptSession.uploadId, totalChunks: 1 })
        })).status, 400);
        assert.deepEqual(await readdir(path.join(tempDir, 'uploads')), filesBefore);
        assert.deepEqual(await readdir(path.join(tempDir, 'tmp_chunks')), []);

        const emptyInitiate = await fetch(`${baseUrl}/upload/initiate`, {
            method: 'POST', headers: browserHeaders,
            body: JSON.stringify({ fileName: 'empty.txt', fileSize: 0 })
        });
        const emptySession = await emptyInitiate.json();
        const emptyForm = new FormData();
        emptyForm.append('uploadId', emptySession.uploadId);
        emptyForm.append('chunkNumber', '1');
        emptyForm.append('chunk', new Blob([]), 'chunk.bin');
        assert.equal((await fetch(`${baseUrl}/upload/chunk`, {
            method: 'POST', headers: { Cookie: cookie }, body: emptyForm
        })).status, 200);
        const emptyFinalize = await fetch(`${baseUrl}/upload/finalize`, {
            method: 'POST', headers: browserHeaders,
            body: JSON.stringify({ uploadId: emptySession.uploadId, totalChunks: 1 })
        });
        assert.equal(emptyFinalize.status, 200);
        assert.equal(await (await fetch((await emptyFinalize.json()).link)).text(), '');

        const cancelInitiate = await fetch(`${baseUrl}/upload/initiate`, {
            method: 'POST', headers: browserHeaders,
            body: JSON.stringify({ fileName: 'cancelled.txt', fileSize: 1 })
        });
        const cancelled = await cancelInitiate.json();
        assert.equal((await fetch(`${baseUrl}/upload/${cancelled.uploadId}`, {
            method: 'DELETE', headers: { Cookie: cookie }
        })).status, 200);
        assert.deepEqual(await readdir(path.join(tempDir, 'tmp_chunks')), []);
    }
    finally
    {
        if (child && child.exitCode === null && child.signalCode === null)
        {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
        }
        await rm(tempDir, { recursive: true, force: true });
    }
});
