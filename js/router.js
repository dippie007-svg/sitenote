const SCREENS = ['home', 'setup', 'capture', 'review', 'report-preview', 'settings'];

window.appState = window.appState || {};

const history = [];

export function navigate(screenName, params = {}) {
  const current = currentScreen();
  if (current) history.push(current);

  Object.assign(window.appState, params);

  SCREENS.forEach(name => {
    const el = document.getElementById(`screen-${name}`);
    if (el) el.classList.toggle('active', name === screenName);
  });

  // Update nav active state
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === screenName);
  });

  // Fire screen-shown event
  document.dispatchEvent(new CustomEvent('screen-shown', { detail: { screen: screenName, params } }));
}

export function currentScreen() {
  for (const name of SCREENS) {
    const el = document.getElementById(`screen-${name}`);
    if (el && el.classList.contains('active')) return name;
  }
  return null;
}

export function goBack() {
  if (history.length) {
    const prev = history.pop();
    navigate(prev);
  } else {
    navigate('home');
  }
}
