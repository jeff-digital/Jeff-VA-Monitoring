  function followUpCalendarDays(year, month) {
    const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Array.from({ length: count }, (_, index) => {
      const value = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(index + 1).padStart(2, '0');
      return { day: index + 1, value, available: isFollowUpDateWeekday(value) };
    });
  }

  document.querySelectorAll('[data-follow-up-calendar]').forEach(trigger => {
    const input = document.getElementById(trigger.dataset.followUpCalendar);
    const panel = document.createElement('div');
    panel.className = 'follow-up-calendar';
    panel.id = input.id + 'Calendar';
    panel.setAttribute('popover', 'auto');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Choose a weekday follow-up date');
    trigger.setAttribute('aria-controls', panel.id);
    panel.innerHTML = '<div class="follow-up-calendar-heading"><button type="button" data-calendar-month="-1" aria-label="Previous month">‹</button><strong aria-live="polite"></strong><button type="button" data-calendar-month="1" aria-label="Next month">›</button></div>'
      + '<div class="follow-up-calendar-week" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span class="is-weekend">Sat</span><span class="is-weekend">Sun</span></div>'
      + '<div class="follow-up-calendar-days" role="group" aria-label="Dates"></div><p>Faded weekends are unavailable</p>';
    (input.closest('dialog') || trigger.parentElement).append(panel);
    let year, month;
    const isOpen = () => panel.matches(':popover-open');
    function renderCalendar(focusDate) {
      panel.querySelector('strong').textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 1)));
      const days = followUpCalendarDays(year, month);
      const defaultDate = input.value || nextFollowUpWeekday(today());
      const preferred = focusDate || (days.some(day => day.value === defaultDate && day.available) ? defaultDate : days.find(day => day.available)?.value);
      const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
      panel.querySelector('.follow-up-calendar-days').innerHTML = '<span aria-hidden="true"></span>'.repeat(offset) + days.map(day => {
        const disabled = !day.available || (input.min && day.value < input.min) || (input.max && day.value > input.max);
        return '<button type="button" data-calendar-date="' + day.value + '" class="' + (!day.available ? 'is-weekend ' : '')
          + (day.value === input.value ? 'is-selected ' : '') + (day.value === today() ? 'is-today' : '') + '"'
          + ' aria-label="' + day.value + (!day.available ? ', weekend unavailable' : '') + '" aria-pressed="' + (day.value === input.value) + '"'
          + ' tabindex="' + (!disabled && day.value === preferred ? '0' : '-1') + '"' + (disabled ? ' disabled' : '') + '>' + day.day + '</button>';
      }).join('');
    }
    function positionCalendar() {
      if (!isOpen()) return;
      const rect = input.getBoundingClientRect(), height = panel.getBoundingClientRect().height;
      panel.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 12)) + 'px';
      const below = rect.bottom + 7;
      panel.style.top = Math.max(12, Math.min(below + height <= window.innerHeight - 12 ? below : rect.top - height - 7, window.innerHeight - height - 12)) + 'px';
    }
    function openCalendar() {
      if (input.disabled || input.readOnly) return;
      if (isOpen()) { panel.hidePopover(); return; }
      const value = /^\d{4}-\d{2}-\d{2}$/.test(input.value) ? input.value : today();
      [year, month] = value.split('-').map(Number); month--;
      renderCalendar(); panel.showPopover(); positionCalendar();
      panel.querySelector('[data-calendar-date][tabindex="0"]')?.focus();
    }
    trigger.addEventListener('click', event => { event.preventDefault(); openCalendar(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' && event.altKey) { event.preventDefault(); openCalendar(); }
    });
    panel.addEventListener('toggle', () => trigger.setAttribute('aria-expanded', String(isOpen())));
    panel.addEventListener('click', event => {
      const nav = event.target.closest('[data-calendar-month]');
      if (nav) { const date = new Date(Date.UTC(year, month + Number(nav.dataset.calendarMonth), 1)); year = date.getUTCFullYear(); month = date.getUTCMonth(); renderCalendar(); positionCalendar(); return; }
      const button = event.target.closest('[data-calendar-date]');
      if (!button || button.disabled || !isFollowUpDateWeekday(button.dataset.calendarDate)) return;
      input.value = button.dataset.calendarDate;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      panel.hidePopover(); trigger.focus();
    });
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); panel.hidePopover(); trigger.focus(); return; }
      const button = event.target.closest('[data-calendar-date]');
      const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 })[event.key];
      if (!button || !step) return;
      event.preventDefault();
      const date = new Date(button.dataset.calendarDate + 'T12:00:00Z');
      do { date.setUTCDate(date.getUTCDate() + step); } while (!isFollowUpDateWeekday(date.toISOString().slice(0, 10)));
      year = date.getUTCFullYear(); month = date.getUTCMonth();
      const value = date.toISOString().slice(0, 10);
      renderCalendar(value); panel.querySelector('[data-calendar-date="' + value + '"]')?.focus(); positionCalendar();
    });
    input.closest('dialog')?.addEventListener('close', () => { if (isOpen()) panel.hidePopover(); });
    window.addEventListener('resize', () => { if (isOpen()) panel.hidePopover(); });
    window.addEventListener('scroll', event => { if (isOpen() && !panel.contains(event.target)) panel.hidePopover(); }, true);
  });
