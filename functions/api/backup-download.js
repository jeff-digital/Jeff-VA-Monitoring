const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function automaticBackupReceipt(request, env, user) {
  if (!env.FOLLOW_UP_DELIVERIES) return reply({ error: 'Backup download protection is unavailable.' }, 503);
  let input;
  try { input = await request.json(); } catch { return reply({ error: 'Invalid backup request.' }, 400); }
  if (!input || !['claim', 'complete', 'release'].includes(input.action)
    || !['daily', 'weekly'].includes(input.frequency)
    || Object.keys(input).some(key => !['action', 'frequency', 'claimToken'].includes(key))
    || (input.action !== 'claim' && (typeof input.claimToken !== 'string' || !input.claimToken || input.claimToken.length > 100))) {
    return reply({ error: 'Invalid backup request.' }, 400);
  }
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  const week = date.toISOString().slice(0, 10);
  const id = env.FOLLOW_UP_DELIVERIES.idFromName(JSON.stringify(['automatic-backup', user.id]));
  return env.FOLLOW_UP_DELIVERIES.get(id).fetch(new Request('https://backup.internal/backup', {
    method: 'POST', body: JSON.stringify({ ...input, day, week })
  }));
}

export async function coordinateBackup(storage, input) {
  return storage.transaction(async txn => {
    if (input.action === 'claim') {
      const keys = ['day:' + input.day];
      if (input.frequency === 'weekly') keys.push('week:' + input.week);
      for (const key of keys) {
        const existing = await txn.get(key);
        if (existing) return reply({ status: existing.status });
      }
      const claimToken = crypto.randomUUID();
      const record = { status: 'pending', claimToken, keys, startedAt: new Date().toISOString() };
      for (const key of keys) await txn.put(key, record);
      await txn.put('token:' + claimToken, record);
      return reply({ status: 'claimed', claimToken });
    }
    const record = await txn.get('token:' + input.claimToken);
    if (!record) return reply({ error: 'Backup reservation did not match.' }, 409);
    if (record.status === 'downloaded') return reply({ status: 'downloaded' });
    if (input.action === 'complete') {
      const completed = { ...record, status: 'downloaded' };
      for (const key of record.keys) await txn.put(key, completed);
      await txn.put('token:' + input.claimToken, completed);
      return reply({ status: 'downloaded' });
    }
    for (const key of record.keys) await txn.delete(key);
    await txn.delete('token:' + input.claimToken);
    return reply({ status: 'released' });
  });
}
