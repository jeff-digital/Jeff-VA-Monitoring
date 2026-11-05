  async function privateFileRequest(query, { method = 'GET', body, contentType } = {}) {
    const userId = currentUser?.id;
    if (!userId) throw new Error('Sign in to access your files.');
    const auth = requireSupabase().auth;
    let session = (await auth.getSession()).data?.session;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!session?.access_token || currentUser?.id !== userId || session.user?.id !== userId) throw new Error('Sign in again to access your files.');
      const response = await fetch('/api/files?' + new URLSearchParams(query), {
        method, headers: { authorization: `Bearer ${session.access_token}`, ...(contentType ? { 'content-type': contentType } : {}) },
        ...(body ? { body } : {}), signal: AbortSignal.timeout(90000)
      });
      if (currentUser?.id !== userId) throw new Error('Your account changed while accessing a file.');
      if (response.status === 401 && attempt === 0) { session = (await auth.refreshSession()).data?.session; continue; }
      if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.error || 'Private file storage is unavailable.'); }
      return response;
    }
  }
  async function uploadStoredFile(path, file, contentType) {
    return (await privateFileRequest({ path }, { method: 'PUT', body: file, contentType })).json();
  }
