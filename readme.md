# FileSharer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An extremely simple and lightweight platform for sharing files.

## Features
- No complex setup or configuration required
- Passwort protected dashboard
- Upload files, text and links
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
2.  **Run with docker:**
    ```bash
    docker compose up -d
    ```
    
3.  **Access the web interface:**
    Open your browser and navigate to `http://localhost:3535`.


## Configuration

All important configurations can be made in the docker-compose.yml file.

```yaml
environment:
  - APP_UPLOAD_PASSWORD=password # IMPORTANT: Change this!
  - FORCE_HTTPS_LINKS=false # This is only needed if the server is running behind a reverse proxy with http. (and the reverse proxy is running with https)
  - MAX_FILE_SIZE=250 # The maximum file size that can be uploaded in MB.
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.