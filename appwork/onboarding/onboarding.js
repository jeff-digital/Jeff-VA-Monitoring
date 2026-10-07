(() => {
  'use strict';

  const apiUrl = '/api/onboarding';
  const $ = selector => document.querySelector(selector);
  let token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  if (token) history.replaceState(null, '', location.pathname);

  async function request(body) {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The onboarding request could not be completed.');
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
      await request({ action: 'submit', token, ...answers });
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
      const invite = await request({ action: 'lookup', token });
      $('#welcomeTitle').textContent = `Welcome${invite.clientName ? `, ${invite.clientName}` : ''}`;
      $('#clientEmail').value = invite.clientEmail || '';
      $('#loadingPanel').hidden = true;
      $('#formPanel').hidden = false;
    } catch {
      showUnavailable();
    }
  }

  loadForm();
})();
