  let applicationProgressReview = null;
  let applicationProgressRequest = null;
  const applicationProgressLabels = { on_track: 'On track', needs_attention: 'Needs attention', insufficient_data: 'Not enough data' };

  function renderApplicationProgressAi() {
    const status = $('#applicationProgressAiStatus');
    const result = $('#applicationProgressAiResult');
    const button = $('#reviewApplicationProgress');
    if (!status || !result || !button) return;
    const loading = applicationProgressRequest?.userId === currentUser?.id && Boolean(currentUser);
    const review = applicationProgressReview?.userId === currentUser?.id && currentUser ? applicationProgressReview.result : null;
    button.disabled = loading || !currentUser || !dataReady;
    button.textContent = loading ? 'Reviewing…' : review ? 'Review again' : 'Review progress';
    status.textContent = loading ? 'Reviewing your saved activity…' : applicationProgressReview?.userId === currentUser?.id && applicationProgressReview?.error
      ? applicationProgressReview.error : review ? 'Activity guidance, not a prediction of hiring success. Review again after updating your tracker.'
        : 'Run a review to see what is going well and what needs attention.';
    result.hidden = !review;
    if (!review) { result.innerHTML = ''; return; }
    const metrics = review.metrics;
    const stat = (label, value, previous) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>${previous === undefined ? '' : `<small>${escapeHtml(previous)} in the comparison period</small>`}</div>`;
    result.innerHTML = `<div class="application-progress-ai-assessment"><span class="application-progress-ai-badge is-${escapeHtml(review.status)}">${escapeHtml(applicationProgressLabels[review.status])}</span><small>Reviewed ${escapeHtml(new Date(review.reviewedAt).toLocaleString())}</small></div>
      <p class="application-progress-ai-period">${escapeHtml(metrics.start)} – ${escapeHtml(metrics.through)} · Philippine time. Compared with ${escapeHtml(metrics.previousStart)} – ${escapeHtml(metrics.previousThrough)}; today may be incomplete.</p>
      <dl class="application-progress-ai-stats">${stat('Applications', metrics.current.applications, metrics.previous.applications)}${stat('Matched replies', metrics.current.matchedReplies, metrics.previous.matchedReplies)}${stat('Scheduled interviews', metrics.current.interviews, metrics.previous.interviews)}${stat('Overdue follow-ups', metrics.overdue)}${stat('Follow-ups sent', metrics.current.followUpsSent, metrics.previous.followUpsSent)}${stat('Weekly goal', metrics.weeklyGoal || 'Not set')}</dl>
      <p class="application-progress-ai-summary">${escapeHtml(review.summary)}</p>
      <h3>Suggested next steps</h3><ul>${review.nextSteps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ul>
      <p class="application-progress-ai-note">Matched replies exclude known automated and no-reply senders. Missing or outdated records can affect this review.</p>`;
  }

  async function requestApplicationProgressReview() {
    const userId = currentUser?.id;
    if (!userId || !dataReady || applicationProgressRequest?.userId === userId) return;
    const request = { userId };
    applicationProgressRequest = request;
    if (applicationProgressReview?.userId === userId) applicationProgressReview.error = '';
    renderApplicationProgressAi();
    try {
      const auth = requireSupabase().auth;
      let current = await auth.getSession();
      let session = current.data?.session;
      if (current.error || !session?.access_token || (session.expires_at && session.expires_at <= Date.now() / 1000 + 60)) session = await renewEmailAiSession(auth, userId);
      let review;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (currentUser?.id !== userId || (session?.user?.id && session.user.id !== userId)) return;
        const response = await fetch('/api/application-progress', { method: 'POST',
          headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
          body: '{}', signal: AbortSignal.timeout(35000) });
        const result = await response.json().catch(() => ({}));
        if (currentUser?.id !== userId) return;
        if (response.status === 401 && attempt === 0) { session = await renewEmailAiSession(auth, userId); continue; }
        if (!response.ok) throw new Error(result.error || 'Progress review is unavailable. Please try again.');
        if (!applicationProgressLabels[result.status] || !result.metrics?.current || !result.metrics?.previous
          || typeof result.summary !== 'string' || !Array.isArray(result.nextSteps)) throw new Error('The progress review could not be read. Please try again.');
        review = result;
        break;
      }
      if (currentUser?.id === userId && review) applicationProgressReview = { userId, result: review };
    } catch (error) {
      if (currentUser?.id === userId) applicationProgressReview = { userId,
        result: applicationProgressReview?.userId === userId ? applicationProgressReview.result : null,
        error: error.name === 'TimeoutError' || error.name === 'AbortError' ? 'The review took too long. Please try again later.' : error.message || 'Progress review is temporarily unavailable.' };
    } finally {
      if (applicationProgressRequest === request) applicationProgressRequest = null;
      renderApplicationProgressAi();
    }
  }

  $('#reviewApplicationProgress')?.addEventListener('click', requestApplicationProgressReview);
