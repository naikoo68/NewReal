// Persist a page's drill-down navigation position across full-page refreshes.
// The admin panels track where you are (stream → subject → topic → …) in React
// state, which resets on reload. Saving it to sessionStorage and restoring it on
// mount keeps you exactly where you were after a refresh. sessionStorage is
// per-tab and cleared when the tab closes, so it never leaks between sessions.
export function loadNav(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "{}") || {};
  } catch {
    return {};
  }
}

export function saveNav(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}
