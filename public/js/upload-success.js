document.addEventListener('DOMContentLoaded', function ()
{
    const successDataString = sessionStorage.getItem('uploadSuccessData');

    if (!successDataString)
    {
        window.location.href = '/dashboard';
        return;
    }

    const data = JSON.parse(successDataString);

    const fileLink = document.getElementById('fileLink');
    const copyBtn = document.getElementById('copyBtn');
    const copyText = document.getElementById('copyText');

    document.getElementById('sharedName').textContent = data.fileName || (data.contentType === 'link' ? 'Shared link' : 'Shared text');
    document.getElementById('qrcode').src = data.qrCode;
    document.getElementById('deleteDate').textContent = data.deleteDate;

    fileLink.href = data.link;
    fileLink.textContent = data.link;

    sessionStorage.removeItem('uploadSuccessData');

    copyBtn.addEventListener('click', async () =>
    {
        document.getElementById('copyError').textContent = '';
        try
        {
            await CopyText(fileLink.textContent);
            copyText.textContent = 'Copied!';
            copyBtn.classList.add('copied');

            setTimeout(() =>
            {
                copyText.textContent = 'Copy Link';
                copyBtn.classList.remove('copied');
            }, 2000);
        }
        catch (err)
        {
            console.error('Failed to copy: ', err);
            document.getElementById('copyError').textContent = err.message;
        }
    });
});
