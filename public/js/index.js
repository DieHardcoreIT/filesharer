document.addEventListener('DOMContentLoaded', function() {
    const passwordInput = document.getElementById('password');
    const togglePassword = document.getElementById('togglePassword');
    const submitBtn = document.getElementById('submitPassword');

    // Toggle password visibility
    togglePassword.addEventListener('click', function () {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        this.innerHTML = type === 'password' ? '<i class="far fa-eye"></i>' : '<i class="far fa-eye-slash"></i>';
    });

    // Submit password on enter key press
    passwordInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitBtn.click();
        }
    });

    // Handle password submission
    submitBtn.addEventListener('click', async () => {
        const password = passwordInput.value.trim();

        if (password === '') {
            return;
        }

        passwordInput.value = '';


        const response = await fetch('/verify-password', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password: password})
        });

        // check if the server responded with success (passwort is correct)
        const data = await response.json();
        if (response.ok && data.success) {
            window.location.href = '/dashboard';
            return;
        }

        alert("Wrong Password!");
    });

});