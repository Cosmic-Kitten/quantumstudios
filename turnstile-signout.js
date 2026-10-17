const signOutButton = document.createElement('button');
signOutButton.type = 'button';
signOutButton.textContent = 'Reset verification';
signOutButton.setAttribute('aria-label', 'Sign out of website verification');
signOutButton.title = 'Sign out of website verification';
Object.assign(signOutButton.style, {
  position: 'fixed',
  right: '10px',
  bottom: '10px',
  zIndex: '1000',
  padding: '6px 8px',
  border: '1px solid #53634f',
  borderRadius: '4px',
  background: 'rgba(17, 23, 19, .92)',
  color: '#f2f4ed',
  font: '10px/1.2 system-ui, sans-serif',
  cursor: 'pointer',
  opacity: '.18',
  transition: 'opacity .15s ease'
});
signOutButton.addEventListener('pointerenter', () => { signOutButton.style.opacity = '1'; });
signOutButton.addEventListener('pointerleave', () => { signOutButton.style.opacity = '.18'; });
signOutButton.addEventListener('focus', () => { signOutButton.style.opacity = '1'; });
signOutButton.addEventListener('blur', () => { signOutButton.style.opacity = '.18'; });
signOutButton.addEventListener('click', async () => {
  signOutButton.disabled = true;
  try {
    const response = await fetch('/api/turnstile/signout', {
      method: 'POST',
      credentials: 'same-origin'
    });
    if (!response.ok) throw new Error(`Could not reset verification (${response.status}).`);

    const next = `${location.pathname}${location.search}${location.hash}`;
    const gate = new URL('/turnstile-gate.html', location.origin);
    gate.searchParams.set('next', next);
    location.replace(gate);
  } catch (error) {
    signOutButton.disabled = false;
    signOutButton.title = error instanceof Error ? error.message : 'Could not reset verification.';
  }
});
document.body.append(signOutButton);
