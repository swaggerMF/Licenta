const CONNECTION_MESSAGE = 'Conexiunea cu serverul local s-a întrerupt. Verifică terminalul cu npm run dev.';

function connectionError(message = CONNECTION_MESSAGE) {
  const error = new Error(message);
  error.code = 'CONNECTION_UNAVAILABLE';
  return error;
}

export async function carelinkRequest(path, body, signal) {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    let response;
    try {
      // Never retry POST automatically: a login/export may have reached the server.
      response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw connectionError();
    }
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (signal?.aborted) throw error;
      throw connectionError();
    }
    if (!response.ok) {
      if (response.status >= 500) throw connectionError();
      throw new Error(data?.error || 'Cererea către serverul local nu a putut fi finalizată.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw connectionError();
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
