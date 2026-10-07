const key = (username, kind) => `noor-accounting-draft:v1:${encodeURIComponent(username)}:${kind}`;

export function readAccountingDraft(username, kind, storage) {
  try {
    storage ||= globalThis.localStorage;
    const value = JSON.parse(storage?.getItem(key(username, kind)) || 'null');
    return value?.version === 1 && value.form && typeof value.form === 'object' && !Array.isArray(value.form) ? value : null;
  } catch { return null; }
}

export function readDocumentDraft(username, kind, storage) {
  if (kind !== 'document' && kind !== 'expense') return null;
  const draft = readAccountingDraft(username, kind, storage);
  if (kind === 'document') return draft?.form.type === 'expense' ? null : draft;
  if (draft?.form.type === 'expense') return draft;
  const legacyDraft = readAccountingDraft(username, 'document', storage);
  return legacyDraft?.form.type === 'expense' ? legacyDraft : null;
}

export function writeAccountingDraft(username, kind, form, requestId = null, storage) {
  storage ||= globalThis.localStorage;
  storage?.setItem(key(username, kind), JSON.stringify({ version: 1, form, requestId }));
}

export function clearCommittedDraft(username, requestId, storage) {
  for (const kind of ['document', 'expense', 'opening']) {
    try {
      storage ||= globalThis.localStorage;
      if (readAccountingDraft(username, kind, storage)?.requestId === requestId) storage?.removeItem(key(username, kind));
    } catch { /* Browser cleanup cannot undo an acknowledged database commit. */ }
  }
}
