document.addEventListener('DOMContentLoaded', function() {
    const successDataString = sessionStorage.getItem('uploadSuccessData');

    // Redirect to dashboard if no success data is found
    if (!successDataString) {
        window.location.href = '/dashboard';
        return;
    }

    const data = JSON.parse(successDataString);

    // Update UI with success data
    const fileLink = document.getElementById('fileLink');
    const copyBtn = document.getElementById('copyBtn');
    const copyText = document.getElementById('copyText');

    //document.getElementById('fileName').textContent = data.fileName;
    document.getElementById('qrcode').src  = data.qrCode;
    document.getElementById('deleteDate').textContent = data.deleteDate;

    fileLink.href = data.link;
    fileLink.textContent = data.link;

    // Clean up
    sessionStorage.removeItem('uploadSuccessData');


    // Copy to clipboard functionality
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(fileLink.textContent);
            copyText.textContent = 'Copied!';
            copyBtn.classList.add('copied');

            // Reset button text after 2 seconds
            setTimeout(() => {
                copyText.textContent = 'Copy Link';
                copyBtn.classList.remove('copied');
            }, 2000);
        } catch (err) {
            console.error('Failed to copy: ', err);
        }
    });
});