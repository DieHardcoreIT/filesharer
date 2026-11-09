document.addEventListener('DOMContentLoaded', () =>
{
    const form = document.getElementById('loginForm');
    const passwordInput = document.getElementById('password');
    const togglePassword = document.getElementById('togglePassword');
    const submitButton = document.getElementById('submitPassword');
    const errorMessage = document.getElementById('loginError');
    const submitLabel = submitButton.innerHTML;

    togglePassword.addEventListener('click', () =>
    {
        const visible = passwordInput.type === 'password';
        passwordInput.type = visible ? 'text' : 'password';
        togglePassword.setAttribute('aria-pressed', String(visible));
        togglePassword.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
        togglePassword.innerHTML = visible ? '<i class="far fa-eye-slash" aria-hidden="true"></i>' : '<i class="far fa-eye" aria-hidden="true"></i>';
    });

    form.addEventListener('submit', async (event) =>
    {
        event.preventDefault();
        errorMessage.textContent = '';
        submitButton.disabled = true;
        submitButton.textContent = 'Signing in...';
        try
        {
            const response = await fetch('/verify-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: passwordInput.value })
            });
            const data = await response.json();
            if (response.ok && data.success)
            {
                window.location.href = '/dashboard';
                return;
            }
            errorMessage.textContent = response.status === 401 ? 'That password is not correct. Please try again.' : 'Sign-in is currently unavailable. Please try again later.';
            passwordInput.focus();
        }
        catch
        {
            errorMessage.textContent = 'Could not connect. Check your connection and try again.';
        }
        finally
        {
            submitButton.disabled = false;
            submitButton.innerHTML = submitLabel;
        }
    });
});
