document.addEventListener('DOMContentLoaded', () =>
{
    const copyBtn = document.getElementById('copyBtn');
    const copyText = document.getElementById('copyText');
    const copyLabel = copyText.textContent;
    const content = document.getElementById('linkContent') || document.getElementById('textContent');

    copyBtn.addEventListener('click', async () =>
    {
        document.getElementById('copyError').textContent = '';
        try
        {
            await CopyText(content.textContent);
            copyText.textContent = 'Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() =>
            {
                copyText.textContent = copyLabel;
                copyBtn.classList.remove('copied');
            }, 2000);
        }
        catch (error)
        {
            console.error('Failed to copy:', error);
            document.getElementById('copyError').textContent = error.message;
        }
    });
});
