(() => {
  const storageKey = 'orbit-donation-prompt-v2';
  const donationUrl = 'https://paypal.me/Quantumkitti';
  const snoozeDuration = 5 * 60 * 1000;
  let remainingDelay = 60_000 + Math.random() * 180_000;
  let timer = null;
  let timerStartedAt = 0;

  function readState() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch (error) {
      console.warn('Could not read the Orbit donation prompt preference:', error);
      return null;
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      return true;
    } catch (error) {
      console.warn('Could not save the Orbit donation prompt preference:', error);
      return false;
    }
  }

  const state = readState();
  if (!state || state.dismissed === true) return;
  if (Number.isFinite(state.snoozeUntil) && state.snoozeUntil > Date.now()) {
    remainingDelay = state.snoozeUntil - Date.now();
  }

  const style = document.createElement('style');
  style.textContent = `
    .orbit-donation-dialog {
      width: min(460px, calc(100% - 28px));
      padding: 28px;
      border: 1px solid var(--orbit-line, #344139);
      border-radius: var(--orbit-radius, 8px);
      background: var(--orbit-panel, #19211c);
      color: var(--orbit-text, #f2f4ed);
      box-shadow: 0 24px 80px #0009;
    }
    .orbit-donation-dialog::backdrop { background: #050806c9; backdrop-filter: blur(4px); }
    .orbit-donation-kicker { margin: 0 0 10px; color: var(--orbit-lime, #c9f36b); font: 10px var(--orbit-mono, monospace); letter-spacing: .08em; text-transform: uppercase; }
    .orbit-donation-dialog h2 { margin: 0; font-size: 23px; line-height: 1.2; }
    .orbit-donation-copy { margin: 12px 0 22px; color: var(--orbit-muted, #a0aca2); font-size: 13px; line-height: 1.7; }
    .orbit-donation-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
    .orbit-donation-actions button, .orbit-donation-actions a { min-height: 38px; padding: 0 13px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--orbit-line, #344139); border-radius: var(--orbit-radius, 8px); background: var(--orbit-panel-2, #202a23); color: var(--orbit-text, #f2f4ed); font: inherit; font-size: 11px; font-weight: 700; text-decoration: none; cursor: pointer; }
    .orbit-donation-actions .orbit-donation-give { border-color: var(--orbit-lime, #c9f36b); background: var(--orbit-lime, #c9f36b); color: #172014; }
    .orbit-donation-actions .orbit-donation-never { margin-right: auto; padding-inline: 0; border-color: transparent; background: transparent; color: var(--orbit-muted, #a0aca2); }
    @media (max-width: 440px) {
      .orbit-donation-dialog { padding: 22px; }
      .orbit-donation-actions { justify-content: stretch; }
      .orbit-donation-actions button, .orbit-donation-actions a { flex: 1; }
      .orbit-donation-actions .orbit-donation-never { flex-basis: 100%; margin: 0; }
    }
  `;
  document.head.append(style);

  const dialog = document.createElement('dialog');
  dialog.className = 'orbit-donation-dialog';
  dialog.setAttribute('aria-labelledby', 'orbit-donation-title');
  const kicker = document.createElement('p');
  kicker.className = 'orbit-donation-kicker';
  kicker.textContent = 'A small ask';
  const title = document.createElement('h2');
  title.id = 'orbit-donation-title';
  title.textContent = 'Enjoying Orbit?';
  const copy = document.createElement('p');
  copy.className = 'orbit-donation-copy';
  copy.textContent = 'If Orbit has made finding and launching games easier, consider supporting its development. It’s completely optional.';
  const actions = document.createElement('div');
  actions.className = 'orbit-donation-actions';
  const never = document.createElement('button');
  never.className = 'orbit-donation-never';
  never.type = 'button';
  never.textContent = 'Don’t ask again';
  const later = document.createElement('button');
  later.type = 'button';
  later.textContent = 'Maybe later';
  const donate = document.createElement('a');
  donate.className = 'orbit-donation-give';
  donate.href = donationUrl;
  donate.target = '_blank';
  donate.rel = 'noopener noreferrer';
  donate.textContent = 'Donate with PayPal';
  actions.append(never, later, donate);
  dialog.append(kicker, title, copy, actions);
  document.body.append(dialog);

  function snooze(until = Date.now() + snoozeDuration) {
    saveState({ snoozeUntil: until });
    remainingDelay = Math.max(0, until - Date.now());
    if (dialog.open) dialog.close();
    runTimer();
  }

  later.addEventListener('click', () => snooze());
  never.addEventListener('click', () => {
    saveState({ dismissed: true });
    if (dialog.open) dialog.close();
  });
  donate.addEventListener('click', () => {
    saveState({ dismissed: true });
    if (dialog.open) dialog.close();
  });
  dialog.addEventListener('cancel', () => snooze());

  function showPrompt() {
    timer = null;
    if (document.visibilityState !== 'visible') return;
    const currentState = readState();
    if (!currentState || currentState.dismissed === true) return;
    if (Number.isFinite(currentState.snoozeUntil) && currentState.snoozeUntil > Date.now()) {
      remainingDelay = currentState.snoozeUntil - Date.now();
      runTimer();
      return;
    }
    if (document.querySelector('dialog[open]')) {
      remainingDelay = 10_000;
      runTimer();
      return;
    }
    dialog.showModal();
  }

  function runTimer() {
    if (timer !== null || document.visibilityState !== 'visible') return;
    timerStartedAt = Date.now();
    timer = window.setTimeout(showPrompt, remainingDelay);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer !== null) {
      window.clearTimeout(timer);
      timer = null;
      remainingDelay = Math.max(0, remainingDelay - (Date.now() - timerStartedAt));
    } else if (document.visibilityState === 'visible') {
      runTimer();
    }
  });

  window.addEventListener('storage', event => {
    if (event.key !== storageKey) return;
    let nextState = {};
    try {
      nextState = event.newValue ? JSON.parse(event.newValue) : {};
    } catch (error) {
      console.warn('Could not read an updated Orbit donation prompt preference:', error);
    }
    if (nextState.dismissed === true) {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (dialog.open) dialog.close();
      return;
    }
    if (Number.isFinite(nextState.snoozeUntil) && nextState.snoozeUntil > Date.now()) {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      remainingDelay = nextState.snoozeUntil - Date.now();
      if (dialog.open) dialog.close();
      runTimer();
      return;
    }
    if (timer === null && !dialog.open) {
      remainingDelay = 60_000 + Math.random() * 180_000;
      runTimer();
    }
  });

  runTimer();
})();
