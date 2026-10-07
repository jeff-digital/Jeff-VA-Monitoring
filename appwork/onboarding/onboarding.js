(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  if (token) history.replaceState(null, '', location.pathname);

  async function tokenHash(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function rpc(name, body) {
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
      throw new Error('The secure onboarding form is not configured.');
    }
    const response = await fetch(`${window.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: window.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || 'The onboarding request could not be completed.');
    return result;
  }

  function showUnavailable() {
    $('#loadingPanel').hidden = true;
    $('#formPanel').hidden = true;
    $('#successPanel').hidden = true;
    $('#unavailablePanel').hidden = false;
  }

  function currentAnswers() {
    const formData = new FormData($('#onboardingForm'));
    return {
      contactName: String(formData.get('contactName') || '').trim(),
      phone: String(formData.get('phone') || '').trim(),
      timezone: String(formData.get('timezone') || '').trim(),
      availability: String(formData.get('availability') || '').trim(),
      tools: String(formData.get('tools') || '').trim(),
      priorities: String(formData.get('priorities') || '').trim()
    };
  }

  function showReview(answers) {
    const details = [
      ['Name', answers.contactName],
      ['Email', $('#clientEmail').value],
      ['Phone', answers.phone],
      ['Time zone', answers.timezone],
      ['Availability and preferred working hours', answers.availability],
      ['Tools or platforms', answers.tools],
      ['First-week priorities', answers.priorities]
    ];
    const list = $('#reviewList');
    list.replaceChildren();
    details.forEach(([label, value]) => {
      const item = document.createElement('div');
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      description.textContent = value || 'Not provided';
      item.append(term, description);
      list.append(item);
    });
  }

  $('#onboardingForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    showReview(currentAnswers());
    $('#reviewError').hidden = true;
    $('#reviewDialog').showModal();
  });

  $('#editAnswersButton').addEventListener('click', () => $('#reviewDialog').close());

  $('#confirmSubmitButton').addEventListener('click', async event => {
    const button = event.currentTarget;
    const answers = currentAnswers();
    button.disabled = true;
    $('#reviewError').hidden = true;
    try {
      const submitted = await rpc('submit_client_onboarding', {
        p_token_hash: await tokenHash(token),
        p_contact_name: answers.contactName,
        p_phone: answers.phone,
        p_timezone: answers.timezone,
        p_availability: answers.availability,
        p_tools: answers.tools,
        p_priorities: answers.priorities
      });
      if (submitted !== true) throw new Error('This onboarding link has expired or has already been submitted.');
      token = '';
      $('#reviewDialog').close();
      $('#formPanel').hidden = true;
      $('#successPanel').hidden = false;
    } catch (error) {
      $('#reviewError').textContent = error.message;
      $('#reviewError').hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  async function loadForm() {
    if (!token) {
      showUnavailable();
      return;
    }
    try {
      const invite = await rpc('lookup_client_onboarding_invite', { p_token_hash: await tokenHash(token) });
      if (!invite) throw new Error('Invitation unavailable.');
      $('#welcomeTitle').textContent = `Welcome${invite.client_name ? `, ${invite.client_name}` : ''}`;
      $('#clientEmail').value = invite.client_email || '';
      $('#loadingPanel').hidden = true;
      $('#formPanel').hidden = false;
    } catch {
      showUnavailable();
    }
  }

  loadForm();
})();
