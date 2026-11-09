async function CopyText(text)
{
    if (navigator.clipboard?.writeText)
    {
        try
        {
            await navigator.clipboard.writeText(text);
            return;
        }
        catch
        {
            // Permissions or browser policies can reject the modern API.
        }
    }

    // HTTP deployments may not expose navigator.clipboard at all.
    const activeElement = document.activeElement;
    const input = document.createElement('textarea');
    input.value = text;
    input.readOnly = true;
    input.style.position = 'fixed';
    input.style.top = '0';
    input.style.opacity = '0';
    document.body.append(input);
    try
    {
        input.focus({ preventScroll: true });
        input.select();
        if (typeof document.execCommand !== 'function' || !document.execCommand('copy'))
        {
            throw new Error('Could not copy automatically. Select the content and copy it manually.');
        }
    }
    finally
    {
        input.remove();
        activeElement?.focus({ preventScroll: true });
    }
}
