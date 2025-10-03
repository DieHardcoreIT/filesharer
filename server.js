const express = require("express");
const multer = require("multer");
const path = require("path");
const qrcode = require("qrcode");
const { customAlphabet } = require("nanoid");
const checkDiskSpace = require('check-disk-space').default;
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');
const { isBanned, recordFailedAttempt, resetAttempts } = require('./banManager');

const fs = require('fs');
const fsPromises = require('fs').promises;

const app = express();
const port = process.env.PORT || 3000;

// --- Configuration ---
const UPLOAD_PASSWORD = process.env.APP_UPLOAD_PASSWORD;
if (!UPLOAD_PASSWORD) {
    console.error("FATAL ERROR: APP_UPLOAD_PASSWORD environment variable is not set.");
    process.exit(1);
}

if (UPLOAD_PASSWORD === "password")  {
    console.warn("WARNING: APP_UPLOAD_PASSWORD is set to the default value 'password'. Please change it immediately.");
}

const FORCE_HTTPS_LINKS =  process.env.FORCE_HTTPS_LINKS === "true";
const MAX_FILE_SIZE = process.env.MAX_FILE_SIZE * 1024 * 1024; // Convert to bytes

const DATA_BASE_DIR = __dirname;
const UPLOADS_DIR = path.join(DATA_BASE_DIR, "uploads");
const METADATA_DIR = path.join(DATA_BASE_DIR, "metadata");
const METADATA_FILE = path.join(METADATA_DIR, "fileMetadata.json");
const TMP_CHUNKS_DIR = path.join(DATA_BASE_DIR, "tmp_chunks");

// In-memory storage for active upload sessions.
const activeUploads = {};

let fileMetadata = {};

const COOKIE_EXPIRE_TIME = 30 * 60000; // 30 min

const EXPIRY_OPTIONS = {
    "1h": 1 * 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 1 * 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
};
const DEFAULT_EXPIRY = "1h";
const CLEANUP_INTERVAL = 60 * 1000;

// Use chars that are easy to read
const NANOID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const generateId = customAlphabet(NANOID_ALPHABET, 6);

// --- Utility functions ---
async function ensureDataDirectories() {
    try {
        await fsPromises.mkdir(UPLOADS_DIR, { recursive: true });
        await fsPromises.mkdir(METADATA_DIR, { recursive: true });
        await fsPromises.mkdir(TMP_CHUNKS_DIR, { recursive: true });
        console.log(`Uploads directory: ${UPLOADS_DIR}`);
        console.log(`Metadata directory: ${METADATA_DIR}`);
        console.log(`Temp chunks directory: ${TMP_CHUNKS_DIR}`);
    } catch (err) {
        console.error("Error creating data directories:", err);
        process.exit(1);
    }
}

async function loadMetadata() {
    try {
        const data = await fsPromises.readFile(METADATA_FILE, "utf8");
        fileMetadata = JSON.parse(data);
        console.log("Metadata loaded.");
    } catch (err) {
        if (err.code === "ENOENT") {
            console.log("Metadata file not found, starting with empty list.");
            fileMetadata = {};
        } else {
            console.error("Error loading metadata:", err);
        }
    }
}

async function saveMetadata() {
    try {
        await fsPromises.writeFile(METADATA_FILE, JSON.stringify(fileMetadata, null, 2));
    } catch (err) {
        console.error("Error saving metadata:", err);
    }
}

function calculateDeletionTime(expiryOption) {
    const duration = EXPIRY_OPTIONS[expiryOption] || EXPIRY_OPTIONS[DEFAULT_EXPIRY];
    return Date.now() + duration;
}

async function cleanupExpiredFiles() {
    const now = Date.now();
    let changed = false;
    for (const id in fileMetadata) {
        if (fileMetadata[id].deleteAt && fileMetadata[id].deleteAt <= now) {
            console.log(`Delete expired file: ${fileMetadata[id].originalName} (ID: ${id})`);

            // Text and Link content are only stored in the "metadata" and has no file representation
            if (fileMetadata[id].path !== undefined) {
                try {
                    await fsPromises.unlink(fileMetadata[id].path);
                    console.log(`File ${fileMetadata[id].path} successfully deleted.`);
                } catch (err) {
                    if (err.code === "ENOENT") {
                        console.warn(`File ${fileMetadata[id].path} for ID ${id} not found, already deleted?`);
                    } else {
                        console.error(`Error deleting the file ${fileMetadata[id].path}:`, err);
                    }
                }
            }

            delete fileMetadata[id];
            changed = true;
        }
    }
    if (changed) {
        await saveMetadata();
        console.log("Metadata updated after cleanup.");
    }
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === null || typeof bytes === 'undefined' || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// --- API Authentication Middleware ---
const authenticateApi = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Authorization header missing or malformed' });
    }

    const { recordFailedAttempt, resetAttempts } = req.banUtils;

    const token = authHeader.split(' ')[1];
    if (token !== UPLOAD_PASSWORD) {
        recordFailedAttempt();
        return res.status(401).json({ success: false, error: 'Invalid API key' });
    }

    // Success - reset attempts
    resetAttempts();


    next();
};

// --- fail2ban Middleware ---

function getIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
}

function fail2banMiddleware(req, res, next) {
    const ip = getIp(req);

    if (isBanned(ip)) {
        return res.status(403).send();
    }

    // Attach ban utilities to req for route handlers
    req.banUtils = { recordFailedAttempt: () => recordFailedAttempt(ip), resetAttempts: () => resetAttempts(ip) };
    next();
}

// --- Multer configuration ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const id = generateId();
        req.fileId = id;
        req.originalNameForMeta = file.originalname;
        cb(null, id);
    },
});



const upload = multer({
    storage: storage,
    limits: { fileSize: MAX_FILE_SIZE },
});

// --- Express configuration ---
app.set("view engine", "ejs");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- API routes ---
const apiRouter = express.Router();
app.use('/api/v1', fail2banMiddleware, apiRouter);


// Use the layout middleware
app.use(expressLayouts);

// --- Cookie-Parser ---
app.use(cookieParser());

// --- fail2ban Middleware ---
app.use(fail2banMiddleware);

// 1. Initiate Upload
apiRouter.post('/upload/initiate', authenticateApi, async (req, res) => {
    const { fileName, fileSize, fileHash, expiry } = req.body;
    if (!fileName || !fileSize || !fileHash) {
        return res.status(400).json({ success: false, error: 'Missing required fields: fileName, fileSize, fileHash' });
    }

    const uploadId = uuidv4();
    const uploadDir = path.join(TMP_CHUNKS_DIR, uploadId);

    try {
        await fsPromises.mkdir(uploadDir);
        activeUploads[uploadId] = {
            fileName,
            fileSize,
            fileHash,
            expiry: expiry || DEFAULT_EXPIRY,
            startTime: Date.now(),
            path: uploadDir
        };
        console.log(`Initiated upload ${uploadId} for ${fileName}`);
        res.status(200).json({
            success: true,
            uploadId: uploadId,
            chunkSize: 8 * 1024 * 1024 // 8 MB
        });
    } catch (err) {
        console.error("API Initiate Error:", err);
        res.status(500).json({ success: false, error: 'Could not initiate upload session' });
    }
});

// 2. Upload Chunk
const chunkUpload = multer({ dest: TMP_CHUNKS_DIR }); // Multer stores chunks temporarily
apiRouter.post('/upload/chunk', authenticateApi, chunkUpload.single('chunk'), async (req, res) => {
    const { uploadId, chunkNumber } = req.body;

    if (!uploadId || !chunkNumber || !req.file) {
        if (req.file) await fsPromises.unlink(req.file.path); // Cleanup
        return res.status(400).json({ success: false, error: 'Missing fields: uploadId, chunkNumber, or chunk data' });
    }

    const session = activeUploads[uploadId];
    if (!session) {
        await fsPromises.unlink(req.file.path); // Cleanup
        return res.status(404).json({ success: false, error: 'Upload ID not found or expired' });
    }

    const chunkPath = path.join(session.path, `chunk-${chunkNumber}`);
    try {
        await fsPromises.rename(req.file.path, chunkPath);
        res.status(200).json({ success: true, message: `Chunk ${chunkNumber} received for uploadId ${uploadId}` });
    } catch (err) {
        console.error(`API Chunk Error (moving chunk ${chunkNumber} for ${uploadId}):`, err);
        res.status(500).json({ success: false, error: 'Error saving chunk' });
    }
});

// 3. Finalize Upload
apiRouter.post('/upload/finalize', authenticateApi, async (req, res) => {
    const { uploadId, totalChunks } = req.body;
    const session = activeUploads[uploadId];
    if (!session) {
        return res.status(404).json({ success: false, error: 'Upload ID not found or expired' });
    }

    const finalFileId = generateId();
    const finalFilePath = path.join(UPLOADS_DIR, finalFileId);
    const writeStream = fs.createWriteStream(finalFilePath);
    const hash = crypto.createHash('sha256');

    try {
        const chunkFiles = await fsPromises.readdir(session.path);
        if (chunkFiles.length != totalChunks) {
            throw new Error(`Missing chunks. Expected ${totalChunks}, but found ${chunkFiles.length}.`);
        }

        console.log(`Finalizing ${uploadId}. Assembling ${totalChunks} chunks...`);
        for (let i = 1; i <= totalChunks; i++) {
            const chunkPath = path.join(session.path, `chunk-${i}`);
            const chunkBuffer = await fsPromises.readFile(chunkPath);
            writeStream.write(chunkBuffer);
            hash.update(chunkBuffer);
        }
        writeStream.end();

        const finalHash = hash.digest('hex');
        if (finalHash !== session.fileHash) {
            await fsPromises.unlink(finalFilePath); // Delete corrupted file
            throw new Error('Hash mismatch. File is corrupt.');
        }

        console.log(`File ${finalFileId} assembled successfully. Hash verified.`);

        //  Save metadata (as with normal upload)
        const deleteAt = calculateDeletionTime(session.expiry);
        fileMetadata[finalFileId] = {
            originalName: session.fileName,
            path: finalFilePath,
            timestamp: new Date().toISOString(),
            deleteAt: deleteAt,
            expirySetting: session.expiry
        };
        await saveMetadata();

        const downloadLink = `${req.protocol}://${req.get("host")}/d/${finalFileId}`;
        const qrCodeDataUrl = await qrcode.toDataURL(downloadLink);
        const deleteDate = new Date(deleteAt).toLocaleString('en-GB', {
            timeZone: 'Europe/Berlin',
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });

        res.status(200).json({
            success: true,
            link: downloadLink,
            qrCode: qrCodeDataUrl,
            fileName: session.fileName,
            deleteDate: deleteDate
        });

    } catch (err) {
        console.error(`API Finalize Error for ${uploadId}:`, err.message);
        // If an error occurs, delete the incomplete file.
        if (writeStream.path && await fsPromises.access(writeStream.path).then(() => true).catch(() => false)) {
            await fsPromises.unlink(writeStream.path);
        }
        res.status(400).json({ success: false, error: err.message });
    } finally {
        // Clean up temporary chunks and session
        await fsPromises.rm(session.path, { recursive: true, force: true });
        delete activeUploads[uploadId];
        console.log(`Cleaned up session for ${uploadId}`);
    }
});

// --- Routen ---

app.get("/", (req, res) => {
    res.render("index", {
        error: null,
    });
});

app.get("/dashboard", async (req, res) => {

    // Just check if a session exists in theory
    if ( req.cookies.login === undefined ) {

        // simple way to show the login form without redirecting to the login page
        res.render("index");

        return;
    }

    // Retrieve information such as storage space

    const diskSpace = await checkDiskSpace(UPLOADS_DIR);

    try {
        const free = diskSpace.free;
        const total = diskSpace.size;
        const used = total - free;
        const percentUsed = (used / total) * 100;


        res.render("dashboard", {
            diskSpaceInfo: {
                free: formatBytes(diskSpace.free),
                size: formatBytes(diskSpace.size),
                percentUsed: percentUsed.toFixed(2)
            },
            expiryOptions: Object.keys(EXPIRY_OPTIONS),
            defaultExpiry: DEFAULT_EXPIRY
        });

    } catch (error) {
        console.error("Error checking disk space:", error);
        res.render("dashboard", {
            expiryOptions: Object.keys(EXPIRY_OPTIONS),
            defaultExpiry: DEFAULT_EXPIRY
        });
    }
});

app.post("/verify-password", (req, res) => {
    const { recordFailedAttempt, resetAttempts } = req.banUtils;

    const { password } = req.body;
    if (password === UPLOAD_PASSWORD) {

        // Success - reset counter
        resetAttempts();

        res.cookie('login', password, { maxAge: COOKIE_EXPIRE_TIME, httpOnly: true });

        res.status(200).json({
            success: true,
        });
    } else {
        recordFailedAttempt();

        res.status(401).json({ success: false, message: "Invalid access code" });
    }
});

// Route for text/link sharing
app.post("/share-text", async (req, res) => {
    const { recordFailedAttempt, resetAttempts } = req.banUtils;

    if ( req.cookies.login === undefined || req.cookies.login !== UPLOAD_PASSWORD) {
        recordFailedAttempt();

        return res.status(403).json({ success: false, error: "Invalid access code!" });
    }

    // Success - reset counter
    resetAttempts();

    let { content, contentType, expiry } = req.body;

    if (!content || !contentType) {
        return res.status(400).json({ success: false, error: "Content and content type are required!" });
    }

    if (!['text', 'link'].includes(contentType)) {
        return res.status(400).json({ success: false, error: "Content type must be 'text' or 'link'!" });
    }

    // Fix the input link if needed
    if (contentType === "link") {
        if (!content.includes("://")) {
            content = "https://" + content;
        }
    }

    try {
        const id = generateId();
        const expiryOption = expiry || DEFAULT_EXPIRY;
        const deleteAt = calculateDeletionTime(expiryOption);

        // Store text/link content in metadata
        fileMetadata[id] = {
            originalName: contentType === 'link' ? 'Shared Link' : 'Shared Text',
            content: content,
            contentType: contentType,
            timestamp: new Date().toISOString(),
            deleteAt: deleteAt,
            expirySetting: expiryOption,
            isTextContent: true
        };
        await saveMetadata();

        // We use the default protocol here
        let protocol = req.protocol;

        // But if this server is behind a reverse proxy with http
        // and does not know that the reverse proxy is https,
        // we need to override the protocol
        if (FORCE_HTTPS_LINKS) {
            protocol = "https";
        }

        const shareLink = `${protocol}://${req.get("host")}/s/${id}`;
        const qrCodeDataUrl = await qrcode.toDataURL(shareLink);
        const deleteDate = new Date(deleteAt).toLocaleString('en-GB', {
            timeZone: 'Europe/Berlin',
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });

        res.status(200).json({
            success: true,
            link: shareLink,
            qrCode: qrCodeDataUrl,
            contentType: contentType,
            deleteDate: deleteDate
        });

    } catch (err) {
        console.error("Error sharing text/link:", err);
        res.status(500).json({ success: false, error: "Error processing share request." });
    }
});




// Custom Authentication Middleware
function isAuthenticated(req, res, next) {
    if ( req.cookies.login === undefined || req.cookies.login !== UPLOAD_PASSWORD) {
        return res.status(403).json({ success: false, error: "Invalid access code!" });
    }

    next();
}

// Custom disk space checking Middleware
async function checkAvailableDiskSpace(req, res, next) {
    try {
        const contentLength = parseInt(req.headers['content-length']);

        const diskSpace = await checkDiskSpace(UPLOADS_DIR);
        if (diskSpace.free < contentLength) {
            await fsPromises.unlink(req.file.path);
            console.warn(`Upload canceled: Not enough storage space for ${req.file.originalname}. Required: ${req.file.size}, Free: ${diskSpace.free}`);
            return res.status(507).json({ success: false, error: "Insufficient storage space to save the file." });
        }
    } catch (diskErr) {
        console.error("Error during disk space check:", diskErr);
    }

    next();
}

app.post(
    "/upload",
    isAuthenticated,
    checkAvailableDiskSpace,
    (req, res, next) => { // Middleware zur Fehlerbehandlung für Multer
        upload.single("fileToUpload")(req, res, (err) => {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(413).json({ // Payload Too Large
                        success: false,
                        error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024 * 1024)} GB.`
                    });
                }
                // Anderer Multer-Fehler
                return res.status(500).json({ success: false, error: err.message });
            } else if (err) {
                // Anderer, nicht-Multer Fehler
                return res.status(500).json({ success: false, error: "An unexpected error occurred during upload." });
            }
            next();
        });
    },
    async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ success: false, error: "No file selected!" });
        }

        const id = req.fileId;
        const originalName = req.originalNameForMeta;
        const filePath = path.join(UPLOADS_DIR, id); // Multer hat die Datei bereits hier gespeichert
        const expiryOption = req.body.expiry || DEFAULT_EXPIRY;
        const deleteAt = calculateDeletionTime(expiryOption);

        fileMetadata[id] = {
            originalName: originalName,
            path: filePath,
            timestamp: new Date().toISOString(),
            deleteAt: deleteAt,
            expirySetting: expiryOption
        };
        await saveMetadata();

        // We use the default protocol here
        let protocol = req.protocol;

        // But if this server is behind a reverse proxy with http
        // and does not know that the reverse proxy is https,
        // we need to override the protocol
        if (FORCE_HTTPS_LINKS) {
            protocol = "https";
        }

        const downloadLink = `${protocol}://${req.get("host")}/d/${id}`;

        try {
            const qrCodeDataUrl = await qrcode.toDataURL(downloadLink);
            const deleteDate = new Date(deleteAt).toLocaleString('en-GB', {
                timeZone: 'Europe/Berlin',
                year: 'numeric', month: 'numeric', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
            });

            // Sende JSON-Antwort für XHR
            res.status(200).json({
                success: true,
                link: downloadLink,
                qrCode: qrCodeDataUrl,
                fileName: originalName,
                deleteDate: deleteDate
            });

        } catch (err) {
            console.error("Error generating QR code/date:", err);
            res.status(500).json({ success: false, error: "Error processing upload details." });
        }
    },
);

// Route for shared text/link content
app.get("/s/:id", (req, res) => {
    const id = req.params.id;
    const metadata = fileMetadata[id];

    if (!metadata || !metadata.isTextContent) {
        return res.status(404).send("Content not found or link invalid/expired.");
    }
    if (metadata.deleteAt && metadata.deleteAt <= Date.now()) {
        return res.status(404).send("Content has expired and was deleted.");
    }

    // Render a simple page to display the content
    res.render("shared-content", {
        content: metadata.content,
        contentType: metadata.contentType,
        originalName: metadata.originalName,
        timestamp: metadata.timestamp
    });
});

app.get("/d/:id", (req, res) => {
    const id = req.params.id;
    const metadata = fileMetadata[id];

    if (!metadata) {
        return res.status(404).send("File not found or link invalid/expired.");
    }
    if (metadata.deleteAt && metadata.deleteAt <= Date.now()) {
        return res.status(404).send("File has expired and was deleted.");
    }

    // Handle text content differently
    if (metadata.isTextContent) {
        return res.redirect(`/s/${id}`);
    }

    fsPromises.access(metadata.path)
        .then(() => {
            res.download(metadata.path, metadata.originalName, (err) => {
                if (err) {
                    console.error("Fehler beim Senden der Datei:", err);
                    if (!res.headersSent) {
                        res.status(500).send("Error downloading file.");
                    }
                }
            });
        })
        .catch(() => {
            console.error(`Datei für ID ${id} nicht im Dateisystem gefunden: ${metadata.path}`);
            res.status(404).send("File not found in filesystem. Link may be outdated.");
        });
});

app.get("/upload-success", (req, res) => {
    //  This page reads the data from sessionStorage, there is nothing to do on the server side except render the EJS file.
    res.render("upload-success");
});

// --- Server Start ---
async function startServer() {
    await ensureDataDirectories();
    await loadMetadata();
    setInterval(cleanupExpiredFiles, CLEANUP_INTERVAL);
    console.log(`Automatic file cleanup active (Checking every ${CLEANUP_INTERVAL / 1000} seconds).`);

    const server = app.listen(port, () => {
        console.log(`FileSharer läuft auf http://localhost:${port}`);
        console.log(`Upload-Verzeichnis: ${UPLOADS_DIR}`);
        console.log(`Max file size: ${formatBytes(MAX_FILE_SIZE)}`);
    });

    // Increased server timeouts for very large uploads
    server.setTimeout(2 * 60 * 60 * 1000); // 2 Hour timeout
    server.headersTimeout = 2 * 60 * 60 * 1000 + 5000; // Slightly longer than server.timeout
}

startServer();