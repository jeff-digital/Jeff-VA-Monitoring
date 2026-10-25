  let applicationProgressReview = null;
  let applicationProgressRequest = null;
  let applicationProgressLastAttempt = null;
  const APPLICATION_PROGRESS_CACHE_KEY = 'jeff-va-application-progress-v1:';
  const APPLICATION_PROGRESS_CACHE_MS = 24 * 60 * 60 * 1000;

  function restoreApplicationProgressReview() {
    const userId = currentUser?.id;
    if (!userId || applicationProgressReview?.userId === userId) return;
    try {
      const saved = JSON.parse(localStorage.getItem(APPLICATION_PROGRESS_CACHE_KEY + userId) || 'null');
      if (saved?.userId !== userId || !Number.isFinite(saved.savedAt) || saved.savedAt > Date.now()) return;
      const review = saved.result;
      if (!applicationProgressLabels[review?.status] || !review.metrics?.current || !review.metrics?.previous
        || typeof review.summary !== 'string' || !Array.isArray(review.nextSteps)) return;
      applicationProgressReview = saved;
    } catch { /* Storage may be blocked or contain an older invalid entry. */ }
  }

  function saveApplicationProgressReview(review) {
    try { localStorage.setItem(APPLICATION_PROGRESS_CACHE_KEY + review.userId, JSON.stringify(review)); }
    catch { /* Keep the in-memory review even when browser storage is full. */ }
  }

  const applicationProgressLabels = { on_track: 'On track', needs_attention: 'Needs attention', insufficient_data: 'Not enough data' };

  function maybeReviewApplicationProgress() {
    const userId = currentUser?.id;
    if (!userId || !dataReady || document.hidden || activeView !== 'dashboard' || activeDashboardTab !== 'application'
      || applicationProgressRequest?.userId === userId) return;
    restoreApplicationProgressReview();
    const previous = applicationProgressReview?.userId === userId ? applicationProgressReview : null;
    if (applicationProgressLastAttempt?.userId === userId && Date.now() - applicationProgressLastAttempt.at < (previous?.error ? 300000 : 60000)) return;
    if (previous?.result && Date.now() - previous.savedAt < APPLICATION_PROGRESS_CACHE_MS) return;
    return requestApplicationProgressReview();
  }

  function renderApplicationProgressAi() {
    restoreApplicationProgressReview();
    const status = $('#applicationProgressAiStatus');
    const result = $('#applicationProgressAiResult');
    const button = $('#reviewApplicationProgress');
    if (!status || !result || !button) return;
    const loading = applicationProgressRequest?.userId === currentUser?.id && Boolean(currentUser);
    const review = applicationProgressReview?.userId === currentUser?.id && currentUser ? applicationProgressReview.result : null;
    button.disabled = loading || !currentUser || !dataReady;
    button.textContent = loading ? 'Reviewing…' : review ? 'Review again' : 'Review progress';
    status.textContent = loading ? 'Reviewing your saved activity…' : applicationProgressReview?.userId === currentUser?.id && applicationProgressReview?.error
      ? applicationProgressReview.error : review ? 'Showing your saved review. It is kept for 24 hours on this browser; choose Review again to include newer activity.'
        : 'Your review starts automatically when you open the Application Dashboard.';
    result.hidden = !review;
    if (!review) { result.innerHTML = ''; return; }
    const metrics = review.metrics;
    const stat = (label, value, previous) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>${previous === undefined ? '' : `<small>${escapeHtml(previous)} in the comparison period</small>`}</div>`;
    const list = (title, values, note = '') => values?.length ? `<section class="application-progress-ai-guidance"><h3>${escapeHtml(title)}</h3>${note ? `<p class="application-progress-ai-note">${escapeHtml(note)}</p>` : ''}<ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul></section>` : '';
    const response = metrics.responseAnalysis;
    const responseText = cohort => cohort.applications ? `${cohort.replyRate}% (${cohort.repliedApplications} of ${cohort.applications})` : 'No applications in this period';
    const responseMarkup = response ? `<section class="application-progress-ai-guidance"><h3>Are replies improving?</h3><dl class="application-progress-ai-stats">${stat('Recent 7-day reply rate', responseText(response.recent))}${stat('Earlier 7-day reply rate', responseText(response.previous))}</dl><p class="application-progress-ai-note">Recent applications: ${escapeHtml(response.recent.start)} – ${escapeHtml(response.recent.end)}. Earlier: ${escapeHtml(response.previous.start)} – ${escapeHtml(response.previous.end)}. Replies are counted in each application's first 7 days. Small samples and missing synced emails can distort rates.</p>
      ${response.bySource.length ? `<div class="application-progress-ai-sources">${response.bySource.map(source => `<div><strong>${escapeHtml(source.source)}</strong><span>${escapeHtml(responseText(source))}${source.applications < response.minimumSample ? ' · small sample' : ''}</span></div>`).join('')}</div>` : ''}</section>` : '';
    const checks = (metrics.applicationChecks || []).filter(check => check.applicationId);
    result.innerHTML = `<div class="application-progress-ai-assessment"><span class="application-progress-ai-badge is-${escapeHtml(review.status)}">${escapeHtml(applicationProgressLabels[review.status])}</span><small>Reviewed ${escapeHtml(new Date(review.reviewedAt).toLocaleString())}</small></div>
      <p class="application-progress-ai-period">${escapeHtml(metrics.start)} – ${escapeHtml(metrics.through)} · Philippine time. Compared with ${escapeHtml(metrics.previousStart)} – ${escapeHtml(metrics.previousThrough)}; today may be incomplete.</p>
      <dl class="application-progress-ai-stats">${stat('Applications', metrics.current.applications, metrics.previous.applications)}${stat('Matched replies', metrics.current.matchedReplies, metrics.previous.matchedReplies)}${stat('Scheduled interviews', metrics.current.interviews, metrics.previous.interviews)}${stat('Overdue follow-ups', metrics.overdue)}${stat('Follow-ups sent', metrics.current.followUpsSent, metrics.previous.followUpsSent)}${stat('Weekly goal', metrics.weeklyGoal || 'Not set')}</dl>
      <p class="application-progress-ai-summary">${escapeHtml(review.summary)}</p>
      ${list('What your records show', review.findings)}
      ${responseMarkup}
      ${list('Why replies may be lower', review.possibleReasons, 'Possible explanations to test, not confirmed causes. The AI has not reviewed your resume or application messages.')}
      ${list('What to improve next', review.nextSteps)}
      ${checks.length ? `<section class="application-progress-ai-guidance"><h3>Applications to review</h3><p class="application-progress-ai-note">These are tracker checks, not a judgment of application quality.</p>${checks.map(check => `<article class="application-progress-ai-check"><strong>${escapeHtml(check.company)}</strong><small>${escapeHtml(check.role)}</small><ul>${check.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul><button class="text-button" type="button" data-progress-application="${escapeHtml(check.applicationId)}">Open application</button></article>`).join('')}</section>` : ''}
      <p class="application-progress-ai-note">Matched replies exclude known automated and no-reply senders. Missing or outdated records can affect this review.</p>`;
  }

  async function requestApplicationProgressReview() {
    const userId = currentUser?.id;
    if (!userId || !dataReady || applicationProgressRequest?.userId === userId) return;
    const request = { userId };
    applicationProgressLastAttempt = { userId, at: Date.now() };
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
      if (currentUser?.id === userId && review) {
        applicationProgressReview = { userId, result: review, savedAt: Date.now() };
        saveApplicationProgressReview(applicationProgressReview);
      }
    } catch (error) {
      if (currentUser?.id === userId) applicationProgressReview = { ...(applicationProgressReview?.userId === userId ? applicationProgressReview : {}), userId,
        result: applicationProgressReview?.userId === userId ? applicationProgressReview.result : null,
        error: error.name === 'TimeoutError' || error.name === 'AbortError' ? 'The review took too long. Please try again later.' : error.message || 'Progress review is temporarily unavailable.' };
    } finally {
      if (applicationProgressRequest === request) applicationProgressRequest = null;
      renderApplicationProgressAi();
    }
  }

  $('#reviewApplicationProgress')?.addEventListener('click', requestApplicationProgressReview);
  document.addEventListener('visibilitychange', maybeReviewApplicationProgress);
  $('#applicationProgressAiResult')?.addEventListener('click', event => {
    const button = event.target.closest('[data-progress-application]');
    if (!button || !currentUser) return;
    const application = data.applications.find(item => item.id === button.dataset.progressApplication);
    if (!application) return;
    showView('applications');
    openClientModal(application.id);
  });
