import { emitKeypressEvents } from 'node:readline';
import { HashPassword } from './authentication.js';

let password = '';
if (process.stdin.isTTY)
{
    process.stderr.write('Password (hidden): ');
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    password = await new Promise((resolve) =>
    {
        function ReadKey(text, key)
        {
            if (key.ctrl && key.name === 'c')
            {
                process.stdin.setRawMode(false);
                process.exit(130);
            }
            if (key.name === 'return')
            {
                process.stdin.off('keypress', ReadKey);
                process.stdin.setRawMode(false);
                process.stdin.pause();
                process.stderr.write('\n');
                resolve(password);
            }
            else if (key.name === 'backspace')
            {
                password = [...password].slice(0, -1).join('');
            }
            else if (text && !key.ctrl && !key.meta && !text.includes('\u001b'))
            {
                password += text;
            }
        }
        process.stdin.on('keypress', ReadKey);
    });
}
else
{
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin)
    {
        password += chunk.toString();
    }
    password = password.replace(/\r?\n$/, '');
}

try
{
    console.log(`APP_UPLOAD_PASSWORD_HASH=${await HashPassword(password)}`);
}
catch (error)
{
    console.error(error.message);
    process.exitCode = 1;
}
