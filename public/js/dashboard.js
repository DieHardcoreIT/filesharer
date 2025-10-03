document.addEventListener('DOMContentLoaded', function() {
    // Tab switching functionality
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.upload-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs and contents
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));

            // Add active class to clicked tab
            tab.classList.add('active');

            // Show corresponding content
            const tabType = tab.getAttribute('data-tab');
            document.getElementById(`${tabType}-content`).classList.add('active');
        });
    });

    // File upload handling
    const fileInput = document.getElementById('fileInput');
    const browseBtn = document.querySelector('.browse-btn');
    const dropZone = document.getElementById('upload-area');

    browseBtn.addEventListener('click', () => {
        fileInput.click();
    });

    // Drag and drop functionality
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#4361ee';
        dropZone.style.backgroundColor = '#f0f4ff';
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = '#e9ecef';
        dropZone.style.backgroundColor = 'transparent';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#e9ecef';
        dropZone.style.backgroundColor = 'transparent';

        if (e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            console.log('Dropped files:', e.dataTransfer.files);
        }
    });

    // Expiration option selection
    const expirationOptions = document.querySelectorAll('.expiration-option');

    expirationOptions.forEach(option => {
        option.addEventListener('click', () => {
            expirationOptions.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
        });
    });

    // Upload button functionality
    const uploadBtn = document.querySelector('.upload-btn');
    uploadBtn.addEventListener('click', () => {
        // Determine active tab
        const activeTab = document.querySelector('.tab.active').getAttribute('data-tab');

        // Handle based on active tab
        if (activeTab === 'file') {
            if (fileInput.files.length === 0) {
                alert('Please select a file to upload');
                return;
            }

            UploadFile(fileInput.files[0]);

        } else if (activeTab === 'text') {
            const textContent = document.getElementById('textContent').value;
            if (!textContent.trim()) {
                alert('Please enter some text');
                return;
            }

            UploadText(textContent);

        } else if (activeTab === 'link') {
            const linkContent = document.getElementById('linkContent').value;
            if (!linkContent.trim()) {
                alert('Please enter a valid URL');
                return;
            }

            UploadLink(linkContent);
        }
    });

    const uploadArea = document.getElementById('upload-area');
    const filePreview = document.getElementById('file-preview');
    const fileName = document.getElementById('file-name');
    const fileSize = document.getElementById('file-size');
    const removeFileBtn = document.getElementById('remove-file');

    // Browse button opens file selection
    browseBtn.addEventListener('click', () => fileInput.click());

    // File selection
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            showFilePreview(file);
        }
    });

    // Drag & Drop Events
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        uploadArea.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, unhighlight, false);
    });

    function highlight() {
        uploadArea.style.borderColor = '#4361ee';
        uploadArea.style.backgroundColor = '#f0f4ff';
    }

    function unhighlight() {
        uploadArea.style.borderColor = '#e9ecef';
        uploadArea.style.backgroundColor = '';
    }

    uploadArea.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            showFilePreview(files[0]);

            // Sync input for form submission
            fileInput.files = files;
        }
    });

    // Show file preview & hide upload area
    function showFilePreview(file) {
        const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
        fileName.textContent = file.name;
        fileSize.textContent = `${sizeInMB} MB`;

        uploadArea.style.display = 'none';
        filePreview.style.display = 'flex';
    }

    // Remove file → Hide preview, show upload area
    if (removeFileBtn) {
        removeFileBtn.addEventListener('click', () => {
            fileInput.value = '';
            filePreview.style.display = 'none';
            uploadArea.style.display = 'block';
        });
    }
});


// Convert a number of bytes into a readable string
function formatBytes(bytes, decimals = 2) {
    if (bytes === null || typeof bytes === 'undefined' || bytes === 0)
        return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Convert a number of seconds into a readable string
function formatETAS(totalSeconds) {
    if (totalSeconds === Infinity || isNaN(totalSeconds) || totalSeconds < 0) {
        return 'Calculating...';
    }
    if (totalSeconds < 1) {
        return '< 1 sec';
    }
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    let etaString = '';
    if (hours > 0) etaString += `${hours}h `;
    if (minutes > 0 || hours > 0) etaString += `${minutes}m `;
    etaString += `${seconds}s`;
    return etaString.trim();
}

async function UploadText(content) {

    const uploadButton = document.querySelector('.upload-btn');

    uploadButton.disabled = true;
    uploadButton.textContent = 'Uploading...';

    // Get expiration value
    const expiration = document.querySelector('input[name="expiration"]:checked').value;

    // Upload
    try {
        const response = await fetch('/share-text', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                content: content,
                contentType: 'text',
                expiry: expiration
            })
        });

        // Get response data and check for success
        const data = await response.json();
        if (response.ok && data.success) {

            // Save data to session storage for redirect
            sessionStorage.setItem('uploadSuccessData', JSON.stringify(data));
            window.location.href = '/upload-success';

        } else {
            alert(data.error || 'Text sharing failed. Please try again.');
        }
    } catch (error) {
        console.error('Text sharing error:', error);
        alert('A network error occurred. Please try again.');
    } finally {
        uploadButton.disabled = false;
        uploadButton.textContent = 'Upload & Generate Link';
    }
}

async function UploadLink(content) {

    const uploadButton = document.querySelector('.upload-btn');

    uploadButton.disabled = true;
    uploadButton.textContent = 'Uploading...';

    // Get expiration value
    const expiration = document.querySelector('input[name="expiration"]:checked').value;


    try {
        const response = await fetch('/share-text', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                content: content,
                contentType: 'link',
                expiry: expiration
            })
        });

        // Get response data and check for success
        const data = await response.json();
        if (response.ok && data.success) {

            // Save data to session storage for redirect
            sessionStorage.setItem('uploadSuccessData', JSON.stringify(data));
            window.location.href = '/upload-success';
        } else {
            alert(data.error || 'Link sharing failed. Please try again.');
        }
    } catch (error) {
        console.error('Link sharing error:', error);
        alert('A network error occurred. Please try again.');
    } finally {
        uploadButton.disabled = false;
        uploadButton.textContent = 'Upload & Generate Link';
    }
}

function UploadFile(file) {
    const uploadButton = document.querySelector('.upload-btn');

    uploadButton.disabled = true;
    uploadButton.textContent = 'Uploading...';

    // Variables to calculate the upload speed
    let lastLoadedBytes = 0;
    let lastTimestamp = 0;
    const SPEED_SAMPLE_COUNT = 20; // Number of samples for the average
    const speedSamples = [];         // Array for the latest speed measurements (bytes/second)
    let lastUiUpdateTime = 0;
    const UI_UPDATE_INTERVAL = 750; // Only update UI every 750ms





    // Get expiration value
    const expiration = document.querySelector('input[name="expiration"]:checked').value;

    // Create FormData and send it to the server
    const formData = new FormData();
    formData.append('fileToUpload', file);
    formData.append('expiry', expiration);


    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload', true);

    xhr.upload.onprogress = function(event) {
        if (event.lengthComputable) {

            // Calculate the upload speed (magic)
            const currentTime = performance.now();
            const elapsedMilliseconds = currentTime - lastTimestamp;

            if (elapsedMilliseconds > 0) {
                const newlyLoadedBytes = event.loaded - lastLoadedBytes;
                const currentSpeedBps = (newlyLoadedBytes / elapsedMilliseconds) * 1000; //  bytes per second

                if (isFinite(currentSpeedBps) && currentSpeedBps >= 0) {
                    speedSamples.push(currentSpeedBps);
                    if (speedSamples.length > SPEED_SAMPLE_COUNT) {
                        speedSamples.shift(); // Remove oldest sample
                    }
                }
            }

            lastLoadedBytes = event.loaded;
            lastTimestamp = currentTime;

            // Only update UI at intervals
            // Here we convert the magic we calculated earlier (the upload speed) into something readable.
            if (currentTime - lastUiUpdateTime > UI_UPDATE_INTERVAL || event.loaded === event.total) {
                let averageSpeedBps = 0;
                if (speedSamples.length > 0) {
                    averageSpeedBps = speedSamples.reduce((acc, val) => acc + val, 0) / speedSamples.length;
                }

                let uploadProcessText = ""

                if (averageSpeedBps > 0) {
                    const remainingBytes = event.total - event.loaded;
                    const etaSeconds = remainingBytes / averageSpeedBps;

                    uploadProcessText = `| Speed: ${formatBytes(averageSpeedBps, 2)}/s ETA: ${formatETAS(etaSeconds)}`;
                } else if (event.loaded === event.total) {
                    uploadProcessText = `| Speed: Done ETA: < 1s`;
                } else if (speedSamples.length > 0 && averageSpeedBps === 0 && event.loaded < event.total) {
                    uploadProcessText = `| Speed: Stalled ETA: Calculating...`;
                } else {
                    uploadProcessText = `| Speed: Calculating... ETA: Calculating...`;
                }

                const percentComplete = (event.loaded / event.total) * 100;
                uploadButton.textContent = `${formatBytes(event.loaded)} / ${formatBytes(event.total)} (${percentComplete.toFixed(1)}%) ${uploadProcessText}`;

                lastUiUpdateTime = currentTime;
            }
        }
    };

    xhr.onload = function() {
        uploadButton.disabled = false;
        uploadButton.textContent = 'Upload & Generate Link';

        // Check if the response status code is successful
        if (xhr.status >= 200 && xhr.status < 300) {
            try {
                // Get response data and check for success
                const responseData = JSON.parse(xhr.responseText);
                if (responseData.success) {

                    // Save data to session storage for redirect
                    sessionStorage.setItem('uploadSuccessData', JSON.stringify(responseData));
                    window.location.href = '/upload-success';
                } else {
                    alert(responseData.error || 'Upload failed. Please try again.');
                }
            } catch (parseError) {
                console.error("Error parsing success response:", parseError, xhr.responseText);
                alert('Upload seemed successful, but response was unclear.');
            }
        } else {
            try {
                const errorData = JSON.parse(xhr.responseText);
                alert(`Upload failed: ${errorData.error || xhr.statusText}`);
            } catch (parseError) {
                alert(`Upload failed with status: ${xhr.status}. ${xhr.statusText}`);
            }
        }
    };
    xhr.onerror = function() {
        uploadButton.disabled = false;
        uploadButton.textContent = 'Upload & Generate Link';
        alert('A network error occurred during upload. Please check your connection.');
    };
    xhr.send(formData);
}