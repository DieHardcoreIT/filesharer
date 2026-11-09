import qrcode from 'qrcode';
import { customAlphabet } from 'nanoid';

const forceHttpsLinks = process.env.FORCE_HTTPS_LINKS === 'true';
// Avoid ambiguous characters in public sharing links.
const GenerateId = customAlphabet('abcdefghjkmnpqrstuvwxyz23456789', 6);

async function CreateShareDetails(req, sharePath, deleteAt)
{
    // Reverse proxies can terminate TLS while the application receives HTTP.
    const protocol = forceHttpsLinks ? 'https' : req.protocol;
    const link = `${protocol}://${req.get('host')}${sharePath}`;
    return {
        success: true,
        link,
        qrCode: await qrcode.toDataURL(link),
        deleteDate: new Date(deleteAt).toLocaleString('en-GB', {
            timeZone: 'Europe/Berlin',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    };
}

export { GenerateId, CreateShareDetails };
