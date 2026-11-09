# FileSharer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An extremely simple and lightweight platform for sharing files.

## Features
- No complex setup or configuration required
- Passwort protected dashboard
- Upload files, text and links
- Select multiple files or folders to share them together as a ZIP archive
- Browser file uploads use separate 8 MiB requests to work through Cloudflare's standard upload limit
- Uploaded files are automatically deleted after a specified time
- [Commandline interface for uploading files](https://github.com/DieHardcoreIT/filesharer-cli)
- Fail2ban like protection

## Prerequisites

-   [Docker](https://www.docker.com/)
-   [Docker Compose](https://docs.docker.com/compose/)

## Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/DieHardcoreIT/FileSharer.git
    cd FileSharer
    ```
2.  **Generate a password hash:**
    ```bash
    npm ci
    npm run --silent password:hash > .env
    ```
    Enter the password at the hidden prompt. Only a salted hash is written to
    `.env`, which is excluded from Git and the Docker image. Node.js 24 or newer
    is needed for this one-time setup. Alternatively, run the generator in Docker:
    ```bash
    docker build -t filesharer:latest .
    docker run --rm -it --entrypoint node filesharer:latest hash-password.js
    ```
    Save the printed `APP_UPLOAD_PASSWORD_HASH=...` line in `.env` before starting
    Compose.

3.  **Run with docker:**
    ```bash
    docker compose up -d
    ```
    
4.  **Access the web interface:**
    Open your browser and navigate to `http://localhost:3535`.


## Local development

Requires Node.js 24 or newer (Docker uses Node.js 26 LTS).

```bash
npm ci
npm run --silent password:hash > .env
npm start
```

In PowerShell:

```powershell
npm run --silent password:hash | Set-Content -Encoding utf8 .env
$env:MAX_FILE_SIZE = '250'
npm start
```

Open `http://localhost:3000`. Run `npm test` for the application smoke test.

## Configuration

All important configurations can be made in the docker-compose.yml file.

```yaml
environment:
  - APP_UPLOAD_PASSWORD_HASH=${APP_UPLOAD_PASSWORD_HASH:?Generate a password hash in .env first}
  - FORCE_HTTPS_LINKS=false # This is only needed if the server is running behind a reverse proxy with http. (and the reverse proxy is running with https)
  - MAX_FILE_SIZE=250 # The maximum file size that can be uploaded in MB.
```

Passwords are stored as salted scrypt hashes (N=32768, r=8, p=3), never as login
cookies. Browser cookies contain random, HttpOnly, SameSite=Lax session tokens;
sessions expire after 30 minutes and are invalidated on server restart. Enable
`FORCE_HTTPS_LINKS=true` behind an HTTPS reverse proxy to mark cookies Secure.
Use HTTPS for remote access. API clients continue to send the original password
as their Bearer credential; the server verifies it against the hash.

When upgrading an existing installation, generate the hash using the existing
password, remove `APP_UPLOAD_PASSWORD` from Compose/environment files, and set
`APP_UPLOAD_PASSWORD_HASH` instead. Recreate the container to discard its old
plaintext environment. Existing browser logins must sign in again. Change the
password if its former plaintext configuration or cookie may have been exposed.

## Large uploads behind Cloudflare

Use **Browse Files** to select multiple files or **Choose Folder** to select a
folder. Repeat either action to add more to the current selection, or drop files
and folders onto the upload area. Multiple files and folders are zipped in the
browser before uploading. Folder paths are retained, and the download contains
one ZIP archive. A single individually selected file is uploaded unchanged.
Empty folders are preserved when dragged onto the upload area; the folder picker
only exposes folders containing files. `MAX_FILE_SIZE` applies to the resulting
ZIP file. The selection remains available if creating or uploading the ZIP fails.

The browser sends files in separate requests containing at most 8 MiB of file data.
The server checks every chunk and assembles the file before returning its download
link. Each interrupted chunk is attempted up to three times. Failed uploads are
cancelled; abandoned upload data is removed after one hour of inactivity, including
leftovers from a server restart.

`MAX_FILE_SIZE` still limits the complete file, rather than each request. The
server needs space for both the temporary chunks and the assembled file. Reverse
proxies must allow at least 9 MiB per request, including multipart overhead; a
custom Cloudflare request limit below that must be increased.

The existing `/api/v1/upload/initiate`, `/chunk` and `/finalize` endpoints remain
available with Bearer authentication. The browser uses `/upload/initiate`, `/chunk`
and `/finalize` with its login cookie. An optional SHA-256 `fileHash` supplied by
API clients is checked during finalization. The old single-request `/upload`
endpoint has been replaced by this chunked workflow.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
