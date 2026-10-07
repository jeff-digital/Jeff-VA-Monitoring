(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const previewMode = new URLSearchParams(location.search).get('preview') === '1';
  let token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  if (token) history.replaceState(null, '', location.pathname);
  const countries = [
    ['Afghanistan', '+93'], ['Albania', '+355'], ['Algeria', '+213'], ['American Samoa', '+1'],
    ['Andorra', '+376'], ['Angola', '+244'], ['Anguilla', '+1'], ['Antigua and Barbuda', '+1'],
    ['Argentina', '+54'], ['Armenia', '+374'], ['Aruba', '+297'], ['Australia', '+61'],
    ['Austria', '+43'], ['Azerbaijan', '+994'], ['Bahamas', '+1'], ['Bahrain', '+973'],
    ['Bangladesh', '+880'], ['Barbados', '+1'], ['Belarus', '+375'], ['Belgium', '+32'],
    ['Belize', '+501'], ['Benin', '+229'], ['Bermuda', '+1'], ['Bhutan', '+975'],
    ['Bolivia', '+591'], ['Bonaire, Sint Eustatius and Saba', '+599'], ['Bosnia and Herzegovina', '+387'],
    ['Botswana', '+267'], ['Brazil', '+55'], ['British Indian Ocean Territory', '+246'],
    ['British Virgin Islands', '+1'], ['Brunei', '+673'], ['Bulgaria', '+359'], ['Burkina Faso', '+226'],
    ['Burundi', '+257'], ['Cambodia', '+855'], ['Cameroon', '+237'], ['Canada', '+1'],
    ['Cape Verde', '+238'], ['Cayman Islands', '+1'], ['Central African Republic', '+236'],
    ['Chad', '+235'], ['Chile', '+56'], ['China', '+86'], ['Christmas Island', '+61'],
    ['Cocos (Keeling) Islands', '+61'], ['Colombia', '+57'], ['Comoros', '+269'], ['Congo', '+242'],
    ['Cook Islands', '+682'], ['Costa Rica', '+506'], ['Croatia', '+385'], ['Cuba', '+53'],
    ['Curaçao', '+599'], ['Cyprus', '+357'], ['Czechia', '+420'], ['Democratic Republic of the Congo', '+243'],
    ['Denmark', '+45'], ['Djibouti', '+253'], ['Dominica', '+1'], ['Dominican Republic', '+1'],
    ['Ecuador', '+593'], ['Egypt', '+20'], ['El Salvador', '+503'], ['Equatorial Guinea', '+240'],
    ['Eritrea', '+291'], ['Estonia', '+372'], ['Eswatini', '+268'], ['Ethiopia', '+251'],
    ['Falkland Islands', '+500'], ['Faroe Islands', '+298'], ['Fiji', '+679'], ['Finland', '+358'],
    ['France', '+33'], ['French Guiana', '+594'], ['French Polynesia', '+689'], ['Gabon', '+241'],
    ['Gambia', '+220'], ['Georgia', '+995'], ['Germany', '+49'], ['Ghana', '+233'],
    ['Gibraltar', '+350'], ['Greece', '+30'], ['Greenland', '+299'], ['Grenada', '+1'],
    ['Guadeloupe', '+590'], ['Guam', '+1'], ['Guatemala', '+502'], ['Guernsey', '+44'],
    ['Guinea', '+224'], ['Guinea-Bissau', '+245'], ['Guyana', '+592'], ['Haiti', '+509'],
    ['Honduras', '+504'], ['Hong Kong', '+852'], ['Hungary', '+36'], ['Iceland', '+354'],
    ['India', '+91'], ['Indonesia', '+62'], ['Iran', '+98'], ['Iraq', '+964'], ['Ireland', '+353'],
    ['Isle of Man', '+44'], ['Israel', '+972'], ['Italy', '+39'], ['Jamaica', '+1'],
    ['Japan', '+81'], ['Jersey', '+44'], ['Jordan', '+962'], ['Kazakhstan', '+7'],
    ['Kenya', '+254'], ['Kiribati', '+686'], ['Kosovo', '+383'], ['Kuwait', '+965'],
    ['Kyrgyzstan', '+996'], ['Laos', '+856'], ['Latvia', '+371'], ['Lebanon', '+961'],
    ['Lesotho', '+266'], ['Liberia', '+231'], ['Libya', '+218'], ['Liechtenstein', '+423'],
    ['Lithuania', '+370'], ['Luxembourg', '+352'], ['Macao', '+853'], ['Madagascar', '+261'],
    ['Malawi', '+265'], ['Malaysia', '+60'], ['Maldives', '+960'], ['Mali', '+223'],
    ['Malta', '+356'], ['Marshall Islands', '+692'], ['Martinique', '+596'], ['Mauritania', '+222'],
    ['Mauritius', '+230'], ['Mayotte', '+262'], ['Mexico', '+52'], ['Micronesia', '+691'],
    ['Moldova', '+373'], ['Monaco', '+377'], ['Mongolia', '+976'], ['Montenegro', '+382'],
    ['Montserrat', '+1'], ['Morocco', '+212'], ['Mozambique', '+258'], ['Myanmar', '+95'],
    ['Namibia', '+264'], ['Nauru', '+674'], ['Nepal', '+977'], ['Netherlands', '+31'],
    ['New Caledonia', '+687'], ['New Zealand', '+64'], ['Nicaragua', '+505'], ['Niger', '+227'],
    ['Nigeria', '+234'], ['Niue', '+683'], ['Norfolk Island', '+672'], ['North Korea', '+850'],
    ['North Macedonia', '+389'], ['Northern Mariana Islands', '+1'], ['Norway', '+47'], ['Oman', '+968'],
    ['Pakistan', '+92'], ['Palau', '+680'], ['Palestine', '+970'], ['Panama', '+507'],
    ['Papua New Guinea', '+675'], ['Paraguay', '+595'], ['Peru', '+51'], ['Philippines', '+63'],
    ['Poland', '+48'], ['Portugal', '+351'], ['Puerto Rico', '+1'], ['Qatar', '+974'],
    ['Réunion', '+262'], ['Romania', '+40'], ['Russia', '+7'], ['Rwanda', '+250'],
    ['Saint Barthélemy', '+590'], ['Saint Helena', '+290'], ['Saint Kitts and Nevis', '+1'],
    ['Saint Lucia', '+1'], ['Saint Martin', '+590'], ['Saint Pierre and Miquelon', '+508'],
    ['Saint Vincent and the Grenadines', '+1'], ['Samoa', '+685'], ['San Marino', '+378'],
    ['São Tomé and Príncipe', '+239'], ['Saudi Arabia', '+966'], ['Senegal', '+221'],
    ['Serbia', '+381'], ['Seychelles', '+248'], ['Sierra Leone', '+232'], ['Singapore', '+65'],
    ['Sint Maarten', '+1'], ['Slovakia', '+421'], ['Slovenia', '+386'], ['Solomon Islands', '+677'],
    ['Somalia', '+252'], ['South Africa', '+27'], ['South Korea', '+82'], ['South Sudan', '+211'],
    ['Spain', '+34'], ['Sri Lanka', '+94'], ['Sudan', '+249'], ['Suriname', '+597'],
    ['Sweden', '+46'], ['Switzerland', '+41'], ['Syria', '+963'], ['Taiwan', '+886'],
    ['Tajikistan', '+992'], ['Tanzania', '+255'], ['Thailand', '+66'], ['Timor-Leste', '+670'],
    ['Togo', '+228'], ['Tokelau', '+690'], ['Tonga', '+676'], ['Trinidad and Tobago', '+1'],
    ['Tunisia', '+216'], ['Türkiye', '+90'], ['Turkmenistan', '+993'], ['Turks and Caicos Islands', '+1'],
    ['Tuvalu', '+688'], ['Uganda', '+256'], ['Ukraine', '+380'], ['United Arab Emirates', '+971'],
    ['United Kingdom', '+44'], ['United States', '+1'], ['United States Virgin Islands', '+1'],
    ['Uruguay', '+598'], ['Uzbekistan', '+998'], ['Vanuatu', '+678'], ['Vatican City', '+39'],
    ['Venezuela', '+58'], ['Vietnam', '+84'], ['Wallis and Futuna', '+681'], ['Yemen', '+967'],
    ['Zambia', '+260'], ['Zimbabwe', '+263']
  ];
  countries.sort((first, second) => first[0].localeCompare(second[0], 'en'));
  countries.forEach(([country, code]) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = `${code} ${country}`;
    $('[name="phoneCountryCode"]').append(option);
  });
  const timeZones = typeof Intl.supportedValuesOf === 'function'
    ? ['UTC', ...Intl.supportedValuesOf('timeZone').filter(zone => zone !== 'UTC')]
    : ['UTC', 'Africa/Cairo', 'Africa/Johannesburg', 'America/Chicago', 'America/Denver',
      'America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'Asia/Dubai',
      'Asia/Hong_Kong', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Seoul', 'Asia/Shanghai',
      'Asia/Singapore', 'Asia/Tokyo', 'Australia/Melbourne', 'Australia/Sydney',
      'Europe/Berlin', 'Europe/London', 'Pacific/Auckland'];
  timeZones.sort((first, second) => first.localeCompare(second, 'en'));
  const currentUtcOffset = zone => {
    const offset = new Intl.DateTimeFormat('en', {
      timeZone: zone,
      timeZoneName: 'longOffset'
    }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value || 'GMT';
    return offset === 'GMT' ? 'UTC+00:00' : offset.replace(/^GMT/, 'UTC');
  };
  timeZones.forEach(zone => {
    const option = document.createElement('option');
    option.value = zone;
    option.textContent = `${zone} (${currentUtcOffset(zone)})`;
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

  function fillPreviewExample() {
    $('#welcomeTitle').textContent = 'Welcome, Jordan';
    $('#clientEmail').value = 'jordan@example.com';
    $('[name="contactName"]').value = 'Jordan Lee';
    $('[name="phoneCountryCode"]').value = '+63';
    $('[name="phone"]').value = '917 123 4567';
    $('[name="timezone"]').value = 'Asia/Manila';
    $('[name="availability"]').value = 'Monday to Friday, 9:00 AM–5:00 PM (UTC+08:00)';
    $('[name="tools"]').value = 'Google Workspace, Slack, Canva';
    $('[name="priorities"]').value = 'Organize the content calendar and prepare the first week of social media posts.';
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
    if (previewMode) {
      $('#reviewDialog').close();
      $('#formPanel').hidden = true;
      $('#successPanel').hidden = false;
      $('#successMessage').hidden = true;
      $('#previewSuccessMessage').hidden = false;
      $('#restartPreviewButton').hidden = false;
      return;
    }
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

  $('#restartPreviewButton').addEventListener('click', () => {
    $('#successPanel').hidden = true;
    $('#formPanel').hidden = false;
    $('#previewSuccessMessage').hidden = true;
    $('#restartPreviewButton').hidden = true;
    fillPreviewExample();
  });

  async function loadForm() {
    if (previewMode) {
      fillPreviewExample();
      $('#previewNotice').hidden = false;
      $('#loadingPanel').hidden = true;
      $('#formPanel').hidden = false;
      return;
    }
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
