(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const previewMode = document.documentElement.dataset.designTest === 'true'
    || new URLSearchParams(location.search).get('preview') === '1';
  const invitationTokenStorageKey = 'jeff-va-client-onboarding-invitation-token';
  const tokenFromUrl = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  let token = tokenFromUrl;
  if (tokenFromUrl) {
    try {
      sessionStorage.setItem(invitationTokenStorageKey, tokenFromUrl);
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    } catch (error) {
      console.error('Unable to preserve the onboarding invitation for a page refresh.', error);
    }
  } else {
    try {
      token = sessionStorage.getItem(invitationTokenStorageKey) || '';
    } catch (error) {
      console.error('Unable to restore the onboarding invitation after a page refresh.', error);
    }
  }
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
  const countryRegions = Object.fromEntries(
    `Afghanistan:AF|Albania:AL|Algeria:DZ|American Samoa:AS|Andorra:AD|Angola:AO|Anguilla:AI|Antigua and Barbuda:AG|Argentina:AR|Armenia:AM|Aruba:AW|Australia:AU|Austria:AT|Azerbaijan:AZ|Bahamas:BS|Bahrain:BH|Bangladesh:BD|Barbados:BB|Belarus:BY|Belgium:BE|Belize:BZ|Benin:BJ|Bermuda:BM|Bhutan:BT|Bolivia:BO|Bonaire, Sint Eustatius and Saba:BQ|Bosnia and Herzegovina:BA|Botswana:BW|Brazil:BR|British Indian Ocean Territory:IO|British Virgin Islands:VG|Brunei:BN|Bulgaria:BG|Burkina Faso:BF|Burundi:BI|Cambodia:KH|Cameroon:CM|Canada:CA|Cape Verde:CV|Cayman Islands:KY|Central African Republic:CF|Chad:TD|Chile:CL|China:CN|Christmas Island:CX|Cocos (Keeling) Islands:CC|Colombia:CO|Comoros:KM|Congo:CG|Cook Islands:CK|Costa Rica:CR|Croatia:HR|Cuba:CU|Curaçao:CW|Cyprus:CY|Czechia:CZ|Democratic Republic of the Congo:CD|Denmark:DK|Djibouti:DJ|Dominica:DM|Dominican Republic:DO|Ecuador:EC|Egypt:EG|El Salvador:SV|Equatorial Guinea:GQ|Eritrea:ER|Estonia:EE|Eswatini:SZ|Ethiopia:ET|Falkland Islands:FK|Faroe Islands:FO|Fiji:FJ|Finland:FI|France:FR|French Guiana:GF|French Polynesia:PF|Gabon:GA|Gambia:GM|Georgia:GE|Germany:DE|Ghana:GH|Gibraltar:GI|Greece:GR|Greenland:GL|Grenada:GD|Guadeloupe:GP|Guam:GU|Guatemala:GT|Guernsey:GG|Guinea:GN|Guinea-Bissau:GW|Guyana:GY|Haiti:HT|Honduras:HN|Hong Kong:HK|Hungary:HU|Iceland:IS|India:IN|Indonesia:ID|Iran:IR|Iraq:IQ|Ireland:IE|Isle of Man:IM|Israel:IL|Italy:IT|Jamaica:JM|Japan:JP|Jersey:JE|Jordan:JO|Kazakhstan:KZ|Kenya:KE|Kiribati:KI|Kosovo:XK|Kuwait:KW|Kyrgyzstan:KG|Laos:LA|Latvia:LV|Lebanon:LB|Lesotho:LS|Liberia:LR|Libya:LY|Liechtenstein:LI|Lithuania:LT|Luxembourg:LU|Macao:MO|Madagascar:MG|Malawi:MW|Malaysia:MY|Maldives:MV|Mali:ML|Malta:MT|Marshall Islands:MH|Martinique:MQ|Mauritania:MR|Mauritius:MU|Mayotte:YT|Mexico:MX|Micronesia:FM|Moldova:MD|Monaco:MC|Mongolia:MN|Montenegro:ME|Montserrat:MS|Morocco:MA|Mozambique:MZ|Myanmar:MM|Namibia:NA|Nauru:NR|Nepal:NP|Netherlands:NL|New Caledonia:NC|New Zealand:NZ|Nicaragua:NI|Niger:NE|Nigeria:NG|Niue:NU|Norfolk Island:NF|North Korea:KP|North Macedonia:MK|Northern Mariana Islands:MP|Norway:NO|Oman:OM|Pakistan:PK|Palau:PW|Palestine:PS|Panama:PA|Papua New Guinea:PG|Paraguay:PY|Peru:PE|Philippines:PH|Poland:PL|Portugal:PT|Puerto Rico:PR|Qatar:QA|Réunion:RE|Romania:RO|Russia:RU|Rwanda:RW|Saint Barthélemy:BL|Saint Helena:SH|Saint Kitts and Nevis:KN|Saint Lucia:LC|Saint Martin:MF|Saint Pierre and Miquelon:PM|Saint Vincent and the Grenadines:VC|Samoa:WS|San Marino:SM|São Tomé and Príncipe:ST|Saudi Arabia:SA|Senegal:SN|Serbia:RS|Seychelles:SC|Sierra Leone:SL|Singapore:SG|Sint Maarten:SX|Slovakia:SK|Slovenia:SI|Solomon Islands:SB|Somalia:SO|South Africa:ZA|South Korea:KR|South Sudan:SS|Spain:ES|Sri Lanka:LK|Sudan:SD|Suriname:SR|Sweden:SE|Switzerland:CH|Syria:SY|Taiwan:TW|Tajikistan:TJ|Tanzania:TZ|Thailand:TH|Timor-Leste:TL|Togo:TG|Tokelau:TK|Tonga:TO|Trinidad and Tobago:TT|Tunisia:TN|Türkiye:TR|Turkmenistan:TM|Turks and Caicos Islands:TC|Tuvalu:TV|Uganda:UG|Ukraine:UA|United Arab Emirates:AE|United Kingdom:GB|United States:US|United States Virgin Islands:VI|Uruguay:UY|Uzbekistan:UZ|Vanuatu:VU|Vatican City:VA|Venezuela:VE|Vietnam:VN|Wallis and Futuna:WF|Yemen:YE|Zambia:ZM|Zimbabwe:ZW`
      .split('|')
      .map(entry => entry.split(':'))
  );
  function createCountryFlag(region = '') {
    const flag = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    flag.classList.add('country-flag');
    flag.setAttribute('viewBox', '0 0 640 480');
    flag.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    if (region) use.setAttribute('href', `./country-flags.svg#flag-${region.toLowerCase()}`);
    flag.append(use);
    return flag;
  }

  function setCountryFlag(flag, region) {
    const use = flag.firstElementChild;
    if (region) use.setAttribute('href', `./country-flags.svg#flag-${region.toLowerCase()}`);
    else use.removeAttribute('href');
  }
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
  function setupSearchablePicker(rootSelector, name, options, placeholder) {
    const root = $(rootSelector);
    const input = root.querySelector('.searchable-picker-input');
    const valueInput = root.querySelector(`[name="${name}"]`);
    const menu = root.querySelector('.searchable-picker-menu');
    const optionsContainer = root.querySelector('.searchable-picker-options');
    let filteredOptions = options;
    let activeIndex = -1;
    let selectedOption = null;
    let selectedFlag;
    if (name === 'phoneCountryCode') {
      selectedFlag = createCountryFlag();
      selectedFlag.classList.add('searchable-picker-selected-flag');
      root.insertBefore(selectedFlag, input);
    }

    function closeMenu(restoreSelection = true) {
      menu.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      activeIndex = -1;
      if (restoreSelection) input.value = selectedOption?.label || '';
      root.classList.toggle('has-selection', Boolean(selectedOption));
      if (selectedFlag) setCountryFlag(selectedFlag, selectedOption?.flag);
    }

    function selectOption(option) {
      selectedOption = option;
      valueInput.value = option.value;
      input.value = option.label;
      root.classList.toggle('has-selection', Boolean(selectedFlag && option.flag));
      if (selectedFlag) setCountryFlag(selectedFlag, option.flag);
      input.setCustomValidity('');
      closeMenu(false);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function renderOptions(query = '') {
      const normalizedQuery = query.trim().toLocaleLowerCase();
      filteredOptions = options.filter(option => !normalizedQuery || option.search.includes(normalizedQuery));
      optionsContainer.replaceChildren();
      activeIndex = filteredOptions.length ? 0 : -1;
      if (!filteredOptions.length) {
        const empty = document.createElement('span');
        empty.className = 'searchable-picker-empty';
        empty.textContent = 'No matching options';
        optionsContainer.append(empty);
        return;
      }
      filteredOptions.forEach((option, index) => {
        const button = document.createElement('button');
        button.className = 'searchable-picker-option';
        button.type = 'button';
        button.tabIndex = -1;
        button.id = `${name}-option-${index}`;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(index === activeIndex));
        if (option.flag) {
          const flag = createCountryFlag(option.flag);
          flag.classList.add('searchable-picker-option-flag');
          button.append(flag);
        }
        const primary = document.createElement('span');
        primary.className = 'searchable-picker-option-primary';
        primary.textContent = option.primary;
        const secondary = document.createElement('span');
        secondary.className = 'searchable-picker-option-secondary';
        secondary.textContent = option.secondary;
        button.append(primary, secondary);
        button.addEventListener('mousedown', event => event.preventDefault());
        button.addEventListener('click', () => selectOption(option));
        optionsContainer.append(button);
      });
      input.setAttribute('aria-activedescendant', `${name}-option-0`);
    }

    function openMenu(query = '') {
      menu.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      renderOptions(query);
    }

    input.placeholder = placeholder;
    if (previewMode && root.id === 'phoneCountryPicker') {
      const mobileQuery = window.matchMedia('(max-width: 639px)');
      const updatePlaceholder = event => { input.placeholder = event.matches ? 'Search' : placeholder; };
      updatePlaceholder(mobileQuery);
      mobileQuery.addEventListener('change', updatePlaceholder);
    }
    input.addEventListener('focus', () => {
      if (selectedOption && input.value === selectedOption.label) input.select();
      openMenu(input.value === selectedOption?.label ? '' : input.value);
    });
    input.addEventListener('click', () => {
      if (menu.hidden) {
        if (selectedOption && input.value === selectedOption.label) input.select();
        openMenu('');
      }
    });
    input.addEventListener('input', () => {
      valueInput.value = '';
      selectedOption = null;
      root.classList.remove('has-selection');
      if (selectedFlag) setCountryFlag(selectedFlag, '');
      input.setCustomValidity('');
      openMenu(input.value);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeMenu();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (menu.hidden) openMenu();
        else if (filteredOptions.length) {
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          activeIndex = (activeIndex + delta + filteredOptions.length) % filteredOptions.length;
          optionsContainer.querySelectorAll('[role="option"]').forEach((option, index) => {
            option.setAttribute('aria-selected', String(index === activeIndex));
          });
          input.setAttribute('aria-activedescendant', `${name}-option-${activeIndex}`);
          optionsContainer.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
        }
      }
      if (event.key === 'Enter' && !menu.hidden && filteredOptions.length) {
        event.preventDefault();
        selectOption(filteredOptions[Math.max(activeIndex, 0)]);
      }
    });
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (!root.contains(document.activeElement)) closeMenu();
      }, 0);
    });
    document.addEventListener('click', event => {
      if (!root.contains(event.target)) closeMenu();
    });
    return {
      setValue(value) {
        const option = options.find(candidate => candidate.value === value);
        if (option) selectOption(option);
      }
    };
  }

  const phoneCountryPicker = setupSearchablePicker(
    '#phoneCountryPicker',
    'phoneCountryCode',
    countries.map(([country, code]) => ({
      value: code,
      flag: countryRegions[country],
      primary: code,
      secondary: country,
      label: code,
      search: `${code} ${country}`.toLocaleLowerCase()
    })),
    'Search country'
  );
  const timezonePicker = setupSearchablePicker(
    '#timezonePicker',
    'timezone',
    timeZones.map(zone => {
      const offset = currentUtcOffset(zone);
      return {
        value: zone,
        primary: zone,
        secondary: offset,
        label: `${zone} (${offset})`,
        search: `${zone} ${zone.split('/').pop().replace(/_/g, ' ')} ${offset}`.toLocaleLowerCase()
      };
    }),
    'Type a city or time zone'
  );

  if ($('#previewForm')) {
    initializeCompactPreview();
    return;
  }

  function initializeCompactPreview() {
    const form = $('#previewForm');
    const draftKey = 'jeff-va-onboarding-preview-single-page-v1';
    const fieldConfig = {
      contactName: { selector: '#contactName', error: '#contactNameError', validate: answers => answers.contactName ? '' : 'Enter your name.' },
      companyName: { selector: '#companyName', error: '#companyNameError', validate: answers => answers.companyName ? '' : 'Enter your company or business name.' },
      phone: {
        selector: '#phone', error: '#phoneError',
        validate: answers => {
          if (!answers.phone) return 'Enter your phone number.';
          if (!/^[0-9\s()./-]+$/.test(answers.phone)) return 'Use digits and common phone separators only.';
          const digits = `${answers.phoneCountryCode}${answers.phone}`.replace(/\D/g, '').length;
          return digits < 4 || digits > 15 ? 'Enter 4–15 digits including the country calling code.' : '';
        }
      },
      phoneCountryCode: {
        selector: '#phoneCountrySearch', error: '#phoneCountryCodeError',
        validate: answers => answers.phoneCountryCode ? '' : 'Choose a country calling code.'
      },
      services: { selector: '#servicesChoices input', error: '#servicesError', validate: answers => answers.services.length ? '' : 'Choose at least one service.' },
      hoursPerWeek: { selector: '#hoursPerWeek', error: '#hoursPerWeekError', validate: answers => answers.hoursPerWeek ? '' : 'Choose your expected hours per week.' },
      preferredChannel: { selector: '#channelChoices input', error: '#preferredChannelError', validate: answers => answers.preferredChannel ? '' : 'Choose a preferred communication channel.' },
      timezone: { selector: '#timezoneSearch', error: '#timezoneError', validate: answers => answers.timezone ? '' : 'Choose a time zone from the suggestions.' },
      availability: { selector: '#availability', error: '#availabilityError', validate: answers => answers.availability ? '' : 'Describe your availability and preferred working hours.' },
      priorities: { selector: '#priorities', error: '#prioritiesError', validate: answers => answers.priorities ? '' : 'Add at least one first-week priority.' },
      backupName: {
        selector: '#backupName', error: '#backupNameError',
        validate: answers => (answers.backupName || answers.backupEmail || answers.backupPhone) && !answers.backupName
          ? 'Enter a name for the backup contact.' : ''
      },
      backupEmail: {
        selector: '#backupEmail', error: '#backupEmailError',
        validate: answers => answers.backupEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.backupEmail)
          ? 'Enter a valid email address.' : ''
      },
      backupPhone: {
        selector: '#backupPhone', error: '#backupPhoneError',
        validate: answers => {
          if (!answers.backupPhone) {
            return (answers.backupName || answers.backupEmail) && !answers.backupEmail
              ? 'Add an email address or phone number for this contact.' : '';
          }
          if (!/^[0-9\s().+/-]+$/.test(answers.backupPhone)) return 'Use digits and common phone separators only.';
          const digits = answers.backupPhone.replace(/\D/g, '').length;
          return digits < 4 || digits > 15 ? 'Enter a phone number with 4–15 digits.' : '';
        }
      },
      agreement: { selector: '#agreement', error: '#agreementError', validate: answers => answers.agreement ? '' : 'Agree to the confidentiality and work terms to continue.' }
    };
    const partConfiguration = [
      {
        title: 'About you',
        description: 'Tell us a little about yourself and your business.',
        fields: ['contactName', 'companyName', 'phoneCountryCode', 'phone']
      },
      {
        title: 'Services and communication',
        description: 'Choose the support you need and how you would like to stay in touch.',
        fields: ['services', 'hoursPerWeek', 'preferredChannel']
      },
      {
        title: 'Schedule',
        description: 'Share your time zone and the hours that work best for you.',
        fields: ['timezone', 'availability']
      },
      {
        title: 'Tools and contacts',
        description: 'Tell us what you use, what matters first, and who to contact if needed.',
        fields: ['priorities', 'backupName', 'backupEmail', 'backupPhone', 'agreement']
      }
    ];
    const partSections = [
      form.querySelector('.about-section'),
      form.querySelector('.services-section'),
      form.querySelector('.schedule-section'),
      form.querySelector('.tools-section')
    ];
    let currentPart = 0;

    function readAnswers() {
      const data = new FormData(form);
      return {
        contactName: String(data.get('contactName') || '').trim(),
        companyName: String(data.get('companyName') || '').trim(),
        role: String(data.get('role') || '').trim(),
        phone: String(data.get('phone') || '').trim(),
        phoneCountryCode: String(data.get('phoneCountryCode') || ''),
        services: data.getAll('services').map(String),
        hoursPerWeek: String(data.get('hoursPerWeek') || ''),
        startDate: String(data.get('startDate') || ''),
        responseTime: String(data.get('responseTime') || ''),
        preferredChannel: String(data.get('preferredChannel') || ''),
        timezone: String(data.get('timezone') || ''),
        availability: String(data.get('availability') || '').trim(),
        blackoutDates: String(data.get('blackoutDates') || '').trim(),
        tools: String(data.get('tools') || '').trim(),
        accessMethod: String(data.get('accessMethod') || ''),
        approval: String(data.get('approval') || '').trim(),
        backupName: String(data.get('backupName') || '').trim(),
        backupEmail: String(data.get('backupEmail') || '').trim(),
        backupPhone: String(data.get('backupPhone') || '').trim(),
        priorities: String(data.get('priorities') || '').trim(),
        agreement: data.get('agreement') === 'yes'
      };
    }

    function validateField(name) {
      const config = fieldConfig[name];
      const message = config.validate(readAnswers());
      const error = $(config.error);
      const field = form.querySelector(`[data-field-key="${name}"]`);
      const controls = [...document.querySelectorAll(config.selector)];
      if (field?.matches('fieldset')) {
        if (message) field.setAttribute('aria-invalid', 'true');
        else field.removeAttribute('aria-invalid');
      } else {
        controls.forEach(control => {
          if (message) control.setAttribute('aria-invalid', 'true');
          else control.removeAttribute('aria-invalid');
        });
      }
      error.textContent = message;
      error.hidden = !message;
      return message;
    }

    function validateBackupContact() {
      return ['backupName', 'backupEmail', 'backupPhone'].map(validateField).some(Boolean);
    }

    function validatePart() {
      let firstInvalid = null;
      for (const name of partConfiguration[currentPart].fields) {
        if (validateField(name) && !firstInvalid) firstInvalid = document.querySelector(fieldConfig[name].selector);
      }
      if (firstInvalid) {
        $('#formAnnouncement').textContent = 'Please correct the highlighted fields before continuing.';
        firstInvalid.focus();
        firstInvalid.scrollIntoView({
          block: 'center',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
        });
        return false;
      }
      $('#formAnnouncement').textContent = '';
      return true;
    }

    function showPart(index, moveFocus = true) {
      currentPart = index;
      partSections.forEach((section, sectionIndex) => { section.hidden = sectionIndex !== currentPart; });
      const part = partConfiguration[currentPart];
      $('#stepProgressText').textContent = `STEP ${currentPart + 1} OF ${partConfiguration.length}`;
      $('#stepProgressName').textContent = part.title;
      $('#stepDescription').textContent = part.description;
      $('#progressRing').setAttribute('aria-valuenow', String(currentPart + 1));
      $('#progressRing').style.setProperty('--progress', `${((currentPart + 1) / partConfiguration.length) * 100}%`);
      $('#progressRingText').textContent = `${Math.round(((currentPart + 1) / partConfiguration.length) * 100)}%`;
      $('#mobileStepText').textContent = `Step ${currentPart + 1} of ${partConfiguration.length}`;
      $('#mobileStepTitle').textContent = part.title;
      $('#stepperList').querySelectorAll('.stepper-item').forEach((item, itemIndex) => {
        item.classList.toggle('is-complete', itemIndex < currentPart);
        item.classList.toggle('is-current', itemIndex === currentPart);
        item.classList.toggle('is-upcoming', itemIndex > currentPart);
        if (itemIndex === currentPart) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
      });
      $('.mobile-segments').querySelectorAll('li').forEach((item, itemIndex) => {
        item.classList.toggle('is-complete', itemIndex < currentPart);
        item.classList.toggle('is-current', itemIndex === currentPart);
      });
      $('#backPartButton').hidden = currentPart === 0;
      $('#agreementField').hidden = currentPart !== partConfiguration.length - 1;
      $('#finishPreviewButton').textContent = currentPart === partConfiguration.length - 1 ? 'Finish preview' : 'Continue';
      if (moveFocus) {
        const heading = $('#stepProgressName');
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        heading.scrollIntoView({
          block: 'nearest',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
        });
      }
    }

    function finishPreview() {
      const name = readAnswers().contactName.split(/\s+/)[0];
      $('#confirmationTitle').textContent = `Thanks${name ? `, ${name}` : ''}`;
      try {
        localStorage.removeItem(draftKey);
        $('#draftStatus').textContent = '';
      } catch (error) {
        $('#draftStatus').textContent = 'Preview complete, but the browser draft could not be cleared. Use Clear draft if needed.';
        console.error('Unable to clear onboarding preview draft.', error);
      }
      form.hidden = true;
      $('#formFooter').hidden = true;
      $('.content-progress').hidden = true;
      $('#confirmationScreen').hidden = false;
      $('#confirmationTitle').focus();
    }

    function saveDraft() {
      const draft = readAnswers();
      draft.agreement = draft.agreement ? 'yes' : '';
      draft.currentPart = currentPart;
      try {
        localStorage.setItem(draftKey, JSON.stringify(draft));
        $('#draftStatus').textContent = 'Draft saved in this browser.';
      } catch (error) {
        $('#draftStatus').textContent = 'Draft could not be saved. Check browser storage settings.';
        console.error('Unable to save onboarding preview draft.', error);
      }
    }

    function restoreDraft() {
      let draft;
      try {
        const saved = localStorage.getItem(draftKey);
        if (!saved) return;
        draft = JSON.parse(saved);
        if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('Draft has an invalid format.');
      } catch (error) {
        $('#draftStatus').textContent = 'The saved draft could not be read. Clear it to start again.';
        console.error('Unable to read onboarding preview draft.', error);
        return;
      }
      Object.entries(draft).forEach(([name, value]) => {
        if (name === 'currentPart') return;
        const controls = [...form.elements].filter(control => control.name === name);
        if (!controls.length) return;
        if (controls[0].type === 'checkbox' && controls.length > 1) {
          controls.forEach(control => { control.checked = Array.isArray(value) && value.includes(control.value); });
        } else if (controls[0].type === 'radio') {
          controls.forEach(control => { control.checked = control.value === value; });
        } else if (controls[0].type === 'checkbox') {
          controls[0].checked = value === 'yes';
        } else if (controls[0].type === 'hidden') {
          if (name === 'phoneCountryCode') phoneCountryPicker.setValue(value);
          if (name === 'timezone') timezonePicker.setValue(value);
        } else if (typeof value === 'string') {
          controls[0].value = value;
        }
      });
      if (Number.isInteger(draft.currentPart) && draft.currentPart >= 0 && draft.currentPart < partConfiguration.length) {
        currentPart = draft.currentPart;
      }
      $('#draftStatus').textContent = 'Restored a draft saved in this browser.';
    }

    restoreDraft();
    showPart(currentPart, false);
    form.addEventListener('input', event => {
      const name = event.target.closest('[data-field-key]')?.dataset.fieldKey;
      if (name && fieldConfig[name]) validateField(name);
      if (name === 'phone') {
        validateField('phoneCountryCode');
        validateField('phone');
      }
      if (name?.startsWith('backup')) validateBackupContact();
      saveDraft();
    });
    form.addEventListener('change', event => {
      const name = event.target.closest('[data-field-key]')?.dataset.fieldKey;
      if (name && fieldConfig[name]) validateField(name);
      saveDraft();
    });
    form.addEventListener('focusout', event => {
      const name = event.target.closest('[data-field-key]')?.dataset.fieldKey;
      if (name && fieldConfig[name]) validateField(name);
      if (name === 'phone') validateField('phoneCountryCode');
      if (name?.startsWith('backup')) validateBackupContact();
    });
    $('#agreement').addEventListener('change', () => {
      validateField('agreement');
      saveDraft();
    });
    $('#agreement').addEventListener('blur', () => validateField('agreement'));
    $('#backPartButton').addEventListener('click', () => {
      if (currentPart > 0) {
        showPart(currentPart - 1);
        saveDraft();
      }
    });
    $('#clearDraftButton').addEventListener('click', () => {
      try {
        localStorage.removeItem(draftKey);
        location.reload();
      } catch (error) {
        $('#draftStatus').textContent = 'Draft could not be cleared. Check browser storage settings.';
        console.error('Unable to clear onboarding preview draft.', error);
      }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!validatePart()) return;
      if (currentPart < partConfiguration.length - 1) {
        showPart(currentPart + 1);
        saveDraft();
        return;
      }
      finishPreview();
    });
  }

  async function tokenHash(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function rpc(name, body) {
    if (previewMode) throw new Error('Submission is disabled in the design preview.');
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

  function showUnavailable(message = 'This invitation may have expired, been replaced, or already been submitted. Please contact your Jeff VA representative if you need help.') {
    if ($('#loadingPanel')) $('#loadingPanel').hidden = true;
    if ($('#formPanel')) $('#formPanel').hidden = true;
    if ($('#successPanel')) $('#successPanel').hidden = true;
    if ($('#unavailablePanel')) $('#unavailablePanel').hidden = false;
    if ($('#unavailableMessage')) $('#unavailableMessage').textContent = message;
  }

  function currentAnswers() {
    const formData = new FormData($('#onboardingForm'));
    return {
      contactName: String(formData.get('contactName') || '').trim(),
      companyName: String(formData.get('companyName') || '').trim(),
      role: String(formData.get('role') || '').trim(),
      phone: String(formData.get('phone') || '').trim(),
      phoneCountryCode: String(formData.get('phoneCountryCode') || ''),
      services: formData.getAll('services').map(String),
      hoursPerWeek: String(formData.get('hoursPerWeek') || ''),
      startDate: String(formData.get('startDate') || ''),
      responseTime: String(formData.get('responseTime') || ''),
      preferredChannel: String(formData.get('preferredChannel') || ''),
      timezone: String(formData.get('timezone') || '').trim(),
      availability: String(formData.get('availability') || '').trim(),
      blackoutDates: String(formData.get('blackoutDates') || '').trim(),
      tools: String(formData.get('tools') || '').trim(),
      accessMethod: String(formData.get('accessMethod') || ''),
      backupName: String(formData.get('backupName') || '').trim(),
      backupEmail: String(formData.get('backupEmail') || '').trim(),
      backupPhone: String(formData.get('backupPhone') || '').trim(),
      priorities: String(formData.get('priorities') || '').trim(),
      approval: String(formData.get('approval') || '').trim(),
      agreement: formData.get('agreement') === 'yes'
    };
  }

  const liveFieldConfig = {
    contactName: { control: '#contactName', field: '[data-field-key="contactName"]', error: '#contactNameError', validate: answers => !answers.contactName ? 'Enter your name.' : answers.contactName.length > 120 ? 'Your name must be 120 characters or fewer.' : '' },
    companyName: { control: '#companyName', field: '[data-field-key="companyName"]', error: '#companyNameError', validate: answers => !answers.companyName ? 'Enter your company or business name.' : answers.companyName.length > 160 ? 'Use 160 characters or fewer.' : '' },
    phoneCountryCode: { control: '#phoneCountrySearch', field: '.phone-field', error: '#phoneCountryCodeError', validate: answers => answers.phoneCountryCode ? '' : 'Choose a country calling code.' },
    phone: {
      control: '#phone', field: '.phone-field', error: '#phoneError',
      validate: answers => {
        if (!answers.phone) return 'Enter your phone number.';
        if (!/^[0-9\s().+/-]+$/.test(answers.phone)) return 'Use digits and common phone separators only.';
        const digits = `${answers.phoneCountryCode}${answers.phone}`.replace(/\D/g, '').length;
        return digits < 4 || digits > 15 ? 'Enter 4–15 digits including the country calling code.' : '';
      }
    },
    services: { control: '#servicesChoices input', field: '[data-field-key="services"]', error: '#servicesError', validate: answers => answers.services.length ? '' : 'Choose at least one service.' },
    hoursPerWeek: { control: '#hoursPerWeek', field: '[data-field-key="hoursPerWeek"]', error: '#hoursPerWeekError', validate: answers => answers.hoursPerWeek ? '' : 'Choose your expected hours per week.' },
    preferredChannel: { control: '#channelChoices input', field: '[data-field-key="preferredChannel"]', error: '#preferredChannelError', validate: answers => answers.preferredChannel ? '' : 'Choose a preferred communication channel.' },
    timezone: { control: '#timezoneSearch', field: '[data-field-key="timezone"]', error: '#timezoneError', validate: answers => answers.timezone ? '' : 'Choose a time zone from the suggestions.' },
    availability: { control: '#availability', field: '[data-field-key="availability"]', error: '#availabilityError', validate: answers => !answers.availability ? 'Describe your availability and preferred working hours.' : answers.availability.length > 2000 ? 'Use 2,000 characters or fewer.' : '' },
    priorities: { control: '#priorities', field: '[data-field-key="priorities"]', error: '#prioritiesError', validate: answers => !answers.priorities ? 'Add at least one first-week priority.' : answers.priorities.length > 2000 ? 'Use 2,000 characters or fewer.' : '' },
    backupName: {
      control: '#backupName', field: '[data-field-key="backupName"]', error: '#backupNameError',
      validate: answers => (answers.backupName || answers.backupEmail || answers.backupPhone) && !answers.backupName
        ? 'Enter a name for the backup contact.' : answers.backupName.length > 120 ? 'Use 120 characters or fewer.' : ''
    },
    backupEmail: {
      control: '#backupEmail', field: '[data-field-key="backupEmail"]', error: '#backupEmailError',
      validate: answers => answers.backupEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.backupEmail)
        ? 'Enter a valid email address.' : answers.backupEmail.length > 254 ? 'Use 254 characters or fewer.' : ''
    },
    backupPhone: {
      control: '#backupPhone', field: '[data-field-key="backupPhone"]', error: '#backupPhoneError',
      validate: answers => {
        if (!answers.backupPhone) return (answers.backupName || answers.backupEmail) && !answers.backupEmail
          ? 'Add an email address or phone number for this contact.' : '';
        if (!/^[0-9\s().+/-]+$/.test(answers.backupPhone)) return 'Use digits and common phone separators only.';
        const digits = answers.backupPhone.replace(/\D/g, '').length;
        return digits < 4 || digits > 15 ? 'Enter a phone number with 4–15 digits.' : '';
      }
    },
    agreement: { control: '#agreement', field: '#agreementField', error: '#agreementError', validate: answers => answers.agreement ? '' : 'Agree to the confidentiality and work terms to continue.' }
  };

  const liveSteps = [
    { title: 'About you', description: 'Tell us a little about yourself and your business.', fields: ['contactName', 'companyName', 'phoneCountryCode', 'phone'] },
    { title: 'Services and communication', description: 'Choose the support you need and how you would like to stay in touch.', fields: ['services', 'hoursPerWeek', 'preferredChannel'] },
    { title: 'Schedule', description: 'Share your time zone and the hours that work best for you.', fields: ['timezone', 'availability'] },
    { title: 'Tools and contacts', description: 'Tell us what you use, what matters first, and who to contact if needed.', fields: ['priorities', 'backupName', 'backupEmail', 'backupPhone', 'agreement'] }
  ];
  const liveSections = [...document.querySelectorAll('#onboardingForm > .form-section')];
  let liveStep = 0;

  function validateLiveField(fieldName) {
    const config = liveFieldConfig[fieldName];
    const message = config.validate(currentAnswers());
    const field = $(config.field);
    const error = $(config.error);
    const controls = [...document.querySelectorAll(config.control)];
    field.toggleAttribute('aria-invalid', Boolean(message));
    controls.forEach(control => {
      if (control.type !== 'checkbox' && control.type !== 'radio') {
        if (message) control.setAttribute('aria-invalid', 'true');
        else control.removeAttribute('aria-invalid');
      }
    });
    error.textContent = message;
    error.hidden = !message;
    return message;
  }

  function validateLiveStep() {
    let firstInvalid;
    for (const fieldName of liveSteps[liveStep].fields) {
      if (validateLiveField(fieldName) && !firstInvalid) firstInvalid = $(liveFieldConfig[fieldName].control);
    }
    if (firstInvalid) {
      $('#formAnnouncement').textContent = 'Please correct the highlighted fields before continuing.';
      firstInvalid.focus();
      firstInvalid.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return false;
    }
    $('#formAnnouncement').textContent = '';
    return true;
  }

  function showLiveStep(index, moveFocus = true) {
    liveStep = index;
    liveSections.forEach((section, sectionIndex) => { section.hidden = sectionIndex !== liveStep; });
    const step = liveSteps[liveStep];
    const completedCount = liveStep + 1;
    const percent = Math.round((completedCount / liveSteps.length) * 100);
    $('#stepProgressText').textContent = `STEP ${completedCount} OF ${liveSteps.length}`;
    $('#stepProgressName').textContent = step.title;
    $('#stepDescription').textContent = step.description;
    $('#progressRing').setAttribute('aria-valuenow', String(completedCount));
    $('#progressRing').style.setProperty('--progress', `${percent}%`);
    $('#progressRingText').textContent = `${percent}%`;
    $('#mobileStepText').textContent = `Step ${completedCount} of ${liveSteps.length}`;
    $('#mobileStepTitle').textContent = step.title;
    $('#stepperList').querySelectorAll('.stepper-item').forEach((item, itemIndex) => {
      item.classList.toggle('is-complete', itemIndex < liveStep);
      item.classList.toggle('is-current', itemIndex === liveStep);
      item.classList.toggle('is-upcoming', itemIndex > liveStep);
      if (itemIndex === liveStep) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    document.querySelectorAll('.mobile-segments li').forEach((item, itemIndex) => {
      item.classList.toggle('is-complete', itemIndex < liveStep);
      item.classList.toggle('is-current', itemIndex === liveStep);
    });
    $('#backPartButton').hidden = liveStep === 0;
    $('#agreementField').hidden = liveStep !== liveSteps.length - 1;
    $('#reviewButton').textContent = liveStep === liveSteps.length - 1
      ? (previewMode ? 'Finish preview' : 'Review my answers')
      : 'Continue';
    if (moveFocus) {
      $('#stepProgressName').focus({ preventScroll: true });
      $('#stepProgressName').scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }

  $('#onboardingForm').addEventListener('input', event => {
    const fieldName = event.target.closest('[data-field-key]')?.dataset.fieldKey;
    if (fieldName && liveFieldConfig[fieldName]) validateLiveField(fieldName);
    if (fieldName === 'phone') validateLiveField('phoneCountryCode');
    if (fieldName?.startsWith('backup')) ['backupName', 'backupEmail', 'backupPhone'].forEach(validateLiveField);
  });
  $('#onboardingForm').addEventListener('change', event => {
    const fieldName = event.target.closest('[data-field-key]')?.dataset.fieldKey;
    if (fieldName && liveFieldConfig[fieldName]) validateLiveField(fieldName);
    if (fieldName === 'phone') validateLiveField('phoneCountryCode');
    if (fieldName?.startsWith('backup')) ['backupName', 'backupEmail', 'backupPhone'].forEach(validateLiveField);
  });
  $('#onboardingForm').addEventListener('focusout', event => {
    const fieldName = event.target.closest('[data-field-key]')?.dataset.fieldKey;
    if (fieldName && liveFieldConfig[fieldName]) validateLiveField(fieldName);
    if (fieldName === 'phone') validateLiveField('phoneCountryCode');
    if (fieldName?.startsWith('backup')) ['backupName', 'backupEmail', 'backupPhone'].forEach(validateLiveField);
  });
  $('#agreement').addEventListener('change', () => validateLiveField('agreement'));
  $('#backPartButton').addEventListener('click', () => {
    if (liveStep > 0) showLiveStep(liveStep - 1);
  });

  function showReview(answers) {
    const details = [
      ['Name', answers.contactName],
      ['Company or business name', answers.companyName],
      ['Role or title', answers.role],
      ['Email', $('#clientEmail').value],
      ['Phone', `${answers.phoneCountryCode} ${answers.phone}`],
      ['Services needed', answers.services.join(', ')],
      ['Expected hours per week', answers.hoursPerWeek],
      ['Desired start date', answers.startDate],
      ['Communication channel', answers.preferredChannel],
      ['Expected response time', answers.responseTime],
      ['Time zone', answers.timezone],
      ['Availability and preferred working hours', answers.availability],
      ['Holidays or blackout dates', answers.blackoutDates],
      ['Tools or platforms', answers.tools],
      ['Access sharing method', answers.accessMethod],
      ['Backup contact name', answers.backupName],
      ['Backup contact email', answers.backupEmail],
      ['Backup contact phone', answers.backupPhone],
      ['First-week priorities', answers.priorities],
      ['Approval preferences', answers.approval],
      ['Confidentiality and terms agreement', answers.agreement ? 'Agreed' : '']
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
    if (!validateLiveStep()) return;
    if (liveStep < liveSteps.length - 1) {
      showLiveStep(liveStep + 1);
      return;
    }
    const answers = currentAnswers();
    if (previewMode) {
      $('#formPanel').hidden = true;
      $('#liveContentProgress').hidden = true;
      $('#successTitle').textContent = 'Preview complete';
      $('.confirmation-screen > p:last-child').textContent = 'Preview completed without sending or saving any information.';
      $('#successPanel').hidden = false;
      $('#successTitle').focus();
      return;
    }
    showReview(answers);
    $('#reviewError').hidden = true;
    $('#reviewDialog').showModal();
  });

  $('#editAnswersButton')?.addEventListener('click', () => $('#reviewDialog').close());

  $('#confirmSubmitButton')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const answers = currentAnswers();
    button.disabled = true;
    $('#reviewError').hidden = true;
    try {
      const submitted = await rpc('submit_client_onboarding', {
        p_token_hash: await tokenHash(token),
        p_contact_name: answers.contactName,
        p_phone: `${answers.phoneCountryCode} ${answers.phone}`,
        p_timezone: answers.timezone,
        p_availability: answers.availability,
        p_tools: answers.tools,
        p_priorities: answers.priorities,
        p_details: {
          companyName: answers.companyName,
          role: answers.role,
          services: answers.services,
          hoursPerWeek: answers.hoursPerWeek,
          startDate: answers.startDate,
          responseTime: answers.responseTime,
          preferredChannel: answers.preferredChannel,
          blackoutDates: answers.blackoutDates,
          accessMethod: answers.accessMethod,
          backupName: answers.backupName,
          backupEmail: answers.backupEmail,
          backupPhone: answers.backupPhone,
          approval: answers.approval,
          agreement: answers.agreement
        }
      });
      if (submitted !== true) throw new Error('This onboarding link has expired, been replaced, or has already been submitted.');
      token = '';
      try {
        sessionStorage.removeItem(invitationTokenStorageKey);
      } catch (error) {
        console.error('Unable to clear the completed onboarding invitation from this browser session.', error);
      }
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
    if (previewMode) {
      if ($('#welcomeTitle')) $('#welcomeTitle').textContent = 'Welcome, Jordan';
      if ($('#clientEmail')) $('#clientEmail').value = 'jordan@example.com';
      if ($('#previewNotice')) $('#previewNotice').hidden = false;
      if ($('#loadingPanel')) $('#loadingPanel').hidden = true;
      if ($('#formPanel')) $('#formPanel').hidden = false;
      showLiveStep(0, false);
      return;
    }
    if (!token) {
      showUnavailable();
      return;
    }
    try {
      const invite = await rpc('lookup_client_onboarding_invite', { p_token_hash: await tokenHash(token) });
      if (!invite) {
        showUnavailable();
        return;
      }
      $('#welcomeTitle').textContent = `Welcome${invite.client_name ? `, ${invite.client_name}` : ''}`;
      $('#clientEmail').value = invite.client_email || '';
      $('#loadingPanel').hidden = true;
      $('#formPanel').hidden = false;
      showLiveStep(0, false);
    } catch {
      showUnavailable('We couldn’t verify this invitation. Check your connection and try again, or contact your Jeff VA representative for help.');
    }
  }

  loadForm();
})();
