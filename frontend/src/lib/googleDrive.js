// Client-side Google Drive backup helper.
//
// Uses Google Identity Services (GIS) with the LIMITED `drive.file` scope, which
// means the app can ONLY see and manage files IT creates — it can never read the
// user's other Drive files. No secrets are stored: the browser gets a short-lived
// access token via a Google popup, uses it, and forgets it.
//
// All backups live in a single folder ("My Study Guide Backups") in the signed-in
// user's own Drive. The OAuth Client ID comes from site settings (admin-set), so
// white-label buyers can plug in their own Google project.

const SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_FOLDER_NAME = "My Study Guide Backups";

// ---- Load Google Identity Services (once) ----
let gisPromise = null;
function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => {
      if (window.google?.accounts?.oauth2) resolve();
      else reject(new Error("Google sign-in could not start. Please try again."));
    };
    s.onerror = () => reject(new Error("Couldn't reach Google. Please check your internet connection and try again."));
    document.head.appendChild(s);
  });
  return gisPromise;
}

// Ask Google for a short-lived access token via a popup. Resolves with the token.
export async function getAccessToken(clientId) {
  const id = String(clientId || "").trim();
  if (!id) throw new Error("Google Drive isn't set up yet. Ask the administrator to add a Google Client ID in Settings.");
  await loadGis();
  return new Promise((resolve, reject) => {
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: id,
        scope: SCOPE,
        callback: (resp) => {
          if (resp && resp.access_token) resolve(resp.access_token);
          else reject(new Error(resp?.error_description || resp?.error || "Google sign-in was cancelled."));
        },
        error_callback: (err) => reject(new Error(err?.message || "Google sign-in was closed or blocked (allow pop-ups and try again).")),
      });
      client.requestAccessToken({ prompt: "" });
    } catch (e) {
      reject(new Error(e?.message || "Google sign-in failed to start."));
    }
  });
}

// ---- Low-level Drive REST helpers ----
async function driveApi(token, path, opts = {}) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = `Google Drive error (${res.status}).`;
    try {
      const j = await res.json();
      if (j?.error?.message) msg = j.error.message;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res;
}

// Find (or create) the app's backup folder in the user's Drive; returns its id.
async function ensureFolder(token) {
  const q = encodeURIComponent(
    `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const res = await driveApi(token, `files?q=${q}&fields=files(id,name)&spaces=drive`);
  const data = await res.json();
  if (data.files && data.files.length) return data.files[0].id;
  const create = await driveApi(token, "files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  return (await create.json()).id;
}

// Find a file by exact name inside the backup folder; returns it or null.
async function findFileByName(token, folderId, name) {
  const q = encodeURIComponent(`'${folderId}' in parents and name='${name.replace(/'/g, "\\'")}' and trashed=false`);
  const res = await driveApi(token, `files?q=${q}&fields=files(id,name,modifiedTime)&spaces=drive&orderBy=modifiedTime desc`);
  return (await res.json()).files?.[0] || null;
}

// Save a JSON backup into the backup folder, WhatsApp-style: if a backup with
// the same name already exists, its contents are UPDATED in place (so Drive
// keeps a single, always-current backup instead of piling up copies). If none
// exists yet, a new one is created. Returns { id, name, updated }.
export async function uploadBackup(token, filename, obj) {
  const folderId = await ensureFolder(token);
  const media = JSON.stringify(obj);
  const existing = await findFileByName(token, folderId, filename);

  if (existing) {
    // Overwrite the existing backup file's content.
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media&fields=id,name`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: media,
      }
    );
    if (!res.ok) {
      let msg = `Updating your Google Drive backup failed (${res.status}).`;
      try { const j = await res.json(); if (j?.error?.message) msg = j.error.message; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return { ...(await res.json()), updated: true };
  }

  // No existing backup — create a new one in the folder.
  const metadata = { name: filename, parents: [folderId], mimeType: "application/json" };
  const boundary = "msgbackup" + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    media +
    `\r\n--${boundary}--`;
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  if (!res.ok) {
    let msg = `Upload to Google Drive failed (${res.status}).`;
    try {
      const j = await res.json();
      if (j?.error?.message) msg = j.error.message;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return { ...(await res.json()), updated: false };
}

// List backup files in the folder (newest first): [{ id, name, modifiedTime }].
export async function listBackups(token) {
  const folderId = await ensureFolder(token);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await driveApi(
    token,
    `files?q=${q}&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime)&spaces=drive`
  );
  return (await res.json()).files || [];
}

// Download and parse a backup file's JSON content by its Drive file id.
export async function downloadBackup(token, fileId) {
  const res = await driveApi(token, `files/${fileId}?alt=media`);
  return res.json();
}
