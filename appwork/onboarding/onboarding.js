(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  if (token) history.replaceState(null, '', location.pathname);
  const callingCodes = [
    '+1', '+7', '+20', '+27', '+30', '+31', '+32', '+33', '+34', '+36', '+39',
    '+40', '+41', '+43', '+44', '+45', '+46', '+47', '+48', '+49', '+51', '+52',
    '+53', '+54', '+55', '+56', '+57', '+58', '+60', '+61', '+62', '+63', '+64',
    '+65', '+66', '+81', '+82', '+84', '+86', '+90', '+91', '+92', '+93', '+94',
    '+95', '+98', '+211', '+212', '+213', '+216', '+218', '+220', '+221', '+222',
    '+223', '+224', '+225', '+226', '+227', '+228', '+229', '+230', '+231', '+232',
    '+233', '+234', '+235', '+236', '+237', '+238', '+239', '+240', '+241', '+242',
    '+243', '+244', '+245', '+246', '+248', '+249', '+250', '+251', '+252', '+253',
    '+254', '+255', '+256', '+257', '+258', '+260', '+261', '+262', '+263', '+264',
    '+265', '+266', '+267', '+268', '+269', '+290', '+291', '+297', '+298', '+299',
    '+350', '+351', '+352', '+353', '+354', '+355', '+356', '+357', '+358', '+359',
    '+370', '+371', '+372', '+373', '+374', '+375', '+376', '+377', '+378', '+380',
    '+381', '+382', '+383', '+385', '+386', '+387', '+389', '+420', '+421', '+423',
    '+500', '+501', '+502', '+503', '+504', '+505', '+506', '+507', '+508', '+509',
    '+590', '+591', '+592', '+593', '+594', '+595', '+596', '+597', '+598', '+599',
    '+670', '+672', '+673', '+674', '+675', '+676', '+677', '+678', '+679', '+680',
    '+681', '+682', '+683', '+685', '+686', '+687', '+688', '+689', '+690', '+691',
    '+692', '+850', '+852', '+853', '+855', '+856', '+880', '+886', '+960', '+961',
    '+962', '+963', '+964', '+965', '+966', '+967', '+968', '+970', '+971', '+972',
    '+973', '+974', '+975', '+976', '+977', '+992', '+993', '+994', '+995', '+996',
    '+998'
  ];
  callingCodes.forEach(code => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = code;
    $('[name="phoneCountryCode"]').append(option);
  });
  const timeZones = typeof Intl.supportedValuesOf === 'function'
    ? ['UTC', ...Intl.supportedValuesOf('timeZone').filter(zone => zone !== 'UTC')]
    : ['UTC', 'Africa/Cairo', 'Africa/Johannesburg', 'America/Chicago', 'America/Denver',
      'America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'Asia/Dubai',
      'Asia/Hong_Kong', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Seoul', 'Asia/Shanghai',
      'Asia/Singapore', 'Asia/Tokyo', 'Australia/Melbourne', 'Australia/Sydney',
      'Europe/Berlin', 'Europe/London', 'Pacific/Auckland'];
  timeZones.forEach(zone => {
    const option = document.createElement('option');
    option.value = zone;
    option.textContent = zone;
    $('[name="timezone"]').append(option);
  });

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
      phoneCountryCode: String(formData.get('phoneCountryCode') || ''),
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
      ['Phone', answers.phone ? `${answers.phoneCountryCode} ${answers.phone}` : ''],
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
    const answers = currentAnswers();
    $('[name="phoneCountryCode"]').required = Boolean(answers.phone);
    if (!form.reportValidity()) return;
    showReview(answers);
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
        p_phone: answers.phone ? `${answers.phoneCountryCode} ${answers.phone}` : '',
        p_timezone: answers.timezone,
        p_availability: answers.availability,
        p_tools: answers.tools,
        p_priorities: answers.priorities
      });
      if (submitted !== true) throw new Error('This onboarding link has expired, been replaced, or has already been submitted.');
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
