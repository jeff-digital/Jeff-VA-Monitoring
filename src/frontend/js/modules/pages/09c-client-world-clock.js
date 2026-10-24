  const CLIENT_WORLD_CLOCKS = [
    ['Australia', 'Sydney', 'Australia/Sydney'], ['Australia', 'Melbourne', 'Australia/Melbourne'],
    ['Australia', 'Brisbane', 'Australia/Brisbane'], ['Australia', 'Perth', 'Australia/Perth'],
    ['Australia', 'Adelaide', 'Australia/Adelaide'], ['Australia', 'Darwin', 'Australia/Darwin'], ['Australia', 'Hobart', 'Australia/Hobart'],
    ['Canada', 'Toronto / Ottawa', 'America/Toronto'], ['Canada', 'Vancouver', 'America/Vancouver'],
    ['Canada', 'Calgary / Edmonton', 'America/Edmonton'], ['Canada', 'Winnipeg', 'America/Winnipeg'],
    ['Canada', 'Halifax', 'America/Halifax'], ['Canada', "St. John's", 'America/St_Johns'],
    ['United States', 'New York / Miami', 'America/New_York'], ['United States', 'Chicago / Dallas', 'America/Chicago'],
    ['United States', 'Denver', 'America/Denver'], ['United States', 'Los Angeles / Seattle', 'America/Los_Angeles'],
    ['United States', 'Phoenix', 'America/Phoenix'], ['United States', 'Anchorage', 'America/Anchorage'], ['United States', 'Honolulu', 'Pacific/Honolulu'],
    ['United Kingdom', 'London', 'Europe/London'], ['Ireland', 'Dublin', 'Europe/Dublin'],
    ['Germany', 'Berlin', 'Europe/Berlin'], ['France', 'Paris', 'Europe/Paris'],
    ['New Zealand', 'Auckland', 'Pacific/Auckland'], ['Philippines', 'Manila', 'Asia/Manila'],
    ['Singapore', 'Singapore', 'Asia/Singapore'], ['United Arab Emirates', 'Dubai', 'Asia/Dubai'],
    ['India', 'Kolkata / New Delhi', 'Asia/Kolkata'], ['Japan', 'Tokyo', 'Asia/Tokyo']
  ].map(([country, city, zone]) => ({ country, city, zone }));
  const worldClockFormatters = new Map();
  let worldClockTimer = null;

  function clientWorldClockTime(zone, now = new Date()) {
    if (!worldClockFormatters.has(zone)) worldClockFormatters.set(zone, {
      time: new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
      date: new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
      offset: new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
    });
    const formats = worldClockFormatters.get(zone);
    return { time: formats.time.format(now), date: formats.date.format(now), offset: formats.offset.formatToParts(now).find(part => part.type === 'timeZoneName')?.value || zone };
  }

  function filterClientWorldClocks(query = '', country = '') {
    const search = String(query).trim().toLowerCase();
    const mainCountries = ['Australia', 'Canada', 'United States'];
    return CLIENT_WORLD_CLOCKS.filter(clock => (!country || (country === 'other' ? !mainCountries.includes(clock.country) : clock.country === country))
      && `${clock.country} ${clock.city} ${clock.zone}`.toLowerCase().includes(search));
  }

  function updateClientWorldClocks() {
    if (!$('#worldClockModal')?.open || document.hidden) return;
    const now = new Date();
    $('#worldClockLocalTime').textContent = `Your time: ${now.toLocaleString()} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
    $$('#worldClockGrid [data-world-clock-zone]').forEach(card => {
      const clock = clientWorldClockTime(card.dataset.worldClockZone, now);
      card.querySelector('time').textContent = clock.time;
      card.querySelector('time').dateTime = now.toISOString();
      card.querySelector('[data-world-clock-date]').textContent = clock.date;
      card.querySelector('[data-world-clock-offset]').textContent = clock.offset;
    });
  }

  function renderClientWorldClocks() {
    const clocks = filterClientWorldClocks($('#worldClockSearch').value, $('#worldClockCountry').value);
    $('#worldClockGrid').innerHTML = clocks.length ? clocks.map(clock => `<article class="world-clock-card" data-world-clock-zone="${escapeHtml(clock.zone)}"><div class="world-clock-card-heading"><strong>${escapeHtml(clock.city)}</strong><small>${escapeHtml(clock.country)}</small></div><time></time><span data-world-clock-date></span><small data-world-clock-offset></small></article>`).join('')
      : '<p class="world-clock-empty">No matching locations. Try a nearby major city or another country.</p>';
    updateClientWorldClocks();
  }

  function stopClientWorldClock() {
    if (worldClockTimer !== null) clearInterval(worldClockTimer);
    worldClockTimer = null;
  }

  function startClientWorldClock() {
    stopClientWorldClock();
    if (!$('#worldClockModal')?.open || document.hidden) return;
    updateClientWorldClocks();
    worldClockTimer = setInterval(updateClientWorldClocks, 1000);
  }

  $('#openClientWorldClock')?.addEventListener('click', () => {
    const dialog = $('#worldClockModal');
    if (!dialog.open) dialog.showModal();
    renderClientWorldClocks();
    startClientWorldClock();
  });
  $('#worldClockSearch')?.addEventListener('input', renderClientWorldClocks);
  $('#worldClockSearch')?.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
  $('#worldClockCountry')?.addEventListener('change', renderClientWorldClocks);
  $('#worldClockModal')?.addEventListener('close', stopClientWorldClock);
  document.addEventListener('visibilitychange', () => document.hidden ? stopClientWorldClock() : startClientWorldClock());
