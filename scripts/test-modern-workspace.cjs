// Browser layout checks use local assets and sample data, with no account or network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../android/design-preview/node_modules/@playwright/test');
const root = path.resolve(__dirname, '../src/frontend');
const output = path.join(process.env.TEMP || process.env.TMP || '.', 'jeff-modern-workspace');

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const workspaceRoutes = [...index.matchAll(/data-view-panel="([^"]+)"/g)].map(match => `/${match[1]}`);
    const previewMarkup = index.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://api.frankfurter.dev' && url.pathname === '/v2/rates') {
        return route.fulfill({ json: [['PHP', 60], ['EUR', 0.8], ['JPY', 150]].map(([quote, rate]) => ({ base: 'USD', quote, rate, date: '2026-11-13' })), headers: { 'access-control-allow-origin': '*' } });
      }
      if (url.hostname !== 'workspace-preview.test') return route.abort();
      if (url.pathname === '/' || workspaceRoutes.includes(url.pathname)) {
        return route.fulfill({ contentType: 'text/html', body: previewMarkup });
      }
      const file = path.join(root, url.pathname);
      if (!fs.existsSync(file)) return route.abort();
      if (file.endsWith('.html')) return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(file, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') });
      return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream' });
    });
    // Exercise loading with the production entrance animations still enabled.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of workspaceRoutes) {
        await page.goto(`https://workspace-preview.test${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => [...document.querySelectorAll('link[href*="css/"]')].filter(link => link.origin === undefined && link.href.startsWith(location.origin)).every(link => link.sheet));
        const loading = await page.evaluate(async () => {
          const view = [...document.querySelectorAll('.content > .view')].find(panel => `/${panel.dataset.viewPanel}` === location.pathname);
          document.querySelector('.content > .view.active')?.classList.remove('active');
          view.classList.add('active');
          const spinner = document.querySelector('.workspace-startup-spinner');
          const area = document.querySelector('#workspaceStartup').getBoundingClientRect();
          const bounds = spinner.getBoundingClientRect();
          const sidebar = document.querySelector('#mainSidebar').getBoundingClientRect();
          const header = document.querySelector('.topbar').getBoundingClientRect();
          const label = document.querySelector('#workspaceStartupMessage').getBoundingClientRect();
          await Promise.all(view.getAnimations().map(animation => animation.finished));
          return {
            centered: Math.abs(bounds.x + bounds.width / 2 - (area.x + area.width / 2)) < 2
              && Math.abs(bounds.y + bounds.height / 2 - (area.y + area.height / 2)) < 2,
            scoped: header.height > 0 && area.top >= header.bottom - 1
              && (innerWidth < 721 || (sidebar.width > 0 && area.left >= sidebar.right - 1)),
            animated: getComputedStyle(spinner).animationName !== 'none',
            skeletons: [...document.querySelectorAll('.hired-loading-cards, .application-loading-rows, .inbox-loading-rows, .workspace-refined-skeleton')].some(element => element.getBoundingClientRect().height > 0),
            dashboardTabsScoped: (document.querySelector('.dashboard-switcher').getBoundingClientRect().height > 0) === (location.pathname === '/dashboard'),
            hiddenData: getComputedStyle(view).opacity === '0',
            hiddenLabel: label.width <= 1 && label.height <= 1
          };
        });
        const { centered, animated, skeletons, ...shared } = loading;
        assert.ok(Object.values(shared).every(Boolean) && (['/hired', '/applications', '/inbox', '/dashboard', '/daily-task', '/subscriptions'].includes(route) ? skeletons : centered && animated && !skeletons), `${route} at ${width}px: ${JSON.stringify(loading)}`);
      }
    }
    console.log(`PASS startup indicators on all ${workspaceRoutes.length} workspace routes at desktop and mobile widths.`);
    await page.goto('https://workspace-preview.test/', { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await page.addScriptTag({ content: `
      const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
      const sortByDate = records => records, applicationAddedDate = item => item.appliedDate, renderAlerts = () => {};
      const persist = () => {}, dateKey = value => value.slice(0, 10);
      const isFollowUpDateWeekday = date => ![0,6].includes(new Date(date + 'T00:00:00Z').getUTCDay());
      const addDays = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0,10);
      const escapeHtml = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
      const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
      const today = () => '2026-11-05', formatDate = value => value;
      const data = {personalDocuments:[], applications:[], invoices:[], subscriptions:[{id:'s1',name:'Canva Pro',account:'jeffrey@example.com',expiryDate:'2026-12-01'}], walletEntries:[{id:'w1',type:'income',account:'wise',cents:5600000,description:'November project payment',date:'2026-11-05'}]};
      const hiredClients = () => [], isActiveContract = () => true;
      const resetScriptForm = () => {}, saveScript = () => {};
      const renderDocumentTemplateOptions = () => {};
      const documentTemplateExample = () => ({application:{},details:{}});
      const buildDocumentEmailTemplate = () => ({subject:'Your next step',body:'Thank you for your time. I look forward to hearing from you.'});
      const htmlEmailBodyFromText = value => '<p>' + escapeHtml(value) + '</p>';
      function previewView(id) {
        $$('.content > .view').forEach(el=>el.classList.toggle('active',el.id===id));
        $('#loginScreen').hidden=true;
        $('#workspaceStartup').hidden=true;
        $('#mainSidebar').inert=false;
        $('.topbar').inert=false;
        document.body.classList.remove('workspace-starting');
        document.body.classList.add('authenticated');
        document.body.classList.remove('auth-loading');
        $('#pageTitle').textContent={documentsView:'Career Tools',dashboardView:'Dashboard',dailyTaskView:'Daily Tasks',applicationsView:'Applications',toApplyView:'To Apply',inboxView:'Email',walletView:'Wallet',subscriptionsView:'Account subscriptions',newsView:'News',socialTrendsView:'Social Trends',hiredView:'Active Clients'}[id];
        $('#pageEyebrow').hidden=true;
        for (const [context, view] of Object.entries({applicationWeekDate:'applicationsView',emailWeekDate:'inboxView',dailyTaskHeaderDate:'dailyTaskView',toApplyHeaderContext:'toApplyView'})) {
          $('#'+context).hidden=id!==view;
          if (context!=='toApplyHeaderContext') $('#'+context).textContent='November 2 – November 8, 2026';
        }
        $('#openAddModal').hidden=id!=='applicationsView';
        $('#openFollowUpTemplate').hidden=id!=='applicationsView';
        $('#hiredHeaderSummary').hidden=id!=='hiredView';
        $('#hiredCountLabel').hidden=id!=='hiredView';
        if(id==='hiredView') { $('#hiredView').classList.remove('client-focused'); $('#hiredList').closest('.hired-panel').hidden=false; $('#hiredView > .toolbar').hidden=false; $('#hiredDetailPanel').classList.add('hidden'); }
        $$('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===$('#'+id).dataset.viewPanel));
      }
      previewView('documentsView');
    ` });
    const formSource = fs.readFileSync(path.join(root, 'js/modules/pages/07c-application-form.js'), 'utf8');
    await page.addScriptTag({ content: formSource.slice(formSource.indexOf('  function enhanceWorkspaceSelect('), formSource.indexOf("  for (const select of $$('#clientForm select'))")) });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/modules/02ad-follow-up-date-picker.js'), 'utf8') });
    for (const file of ['11-tools-page.js', '14-wallet-page.js', '17-subscriptions-page.js', '09-daily-task-page.js']) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/modules/pages', file), 'utf8') });
    }
    // Use the production card renderer so list checks cover real markup and long names.
    const clientsSource = fs.readFileSync(path.join(root, 'js/modules/pages/09b-active-clients-render.js'), 'utf8');
    await page.addScriptTag({content: `
      const isContractEnded = item => item.contractStatus === 'Contract Ended';
      const contractEndingLabel = () => '', activeSinceDate = () => '2026-10-01', emailDate = value => value;
      const matchingEmailsForApplication = () => [], isSentEmail = () => false, clientTimeZones = new Map();
      const getClientTasks = () => [];
      ${clientsSource.slice(clientsSource.indexOf('  function normalizeUrl('), clientsSource.indexOf('  const hiredClientAvatarUrls'))}
      ${clientsSource.slice(clientsSource.indexOf('  function renderActiveClientCard('), clientsSource.indexOf("  $('#backToHiredList').addEventListener"))}
      $('#hiredList').innerHTML = [
        {id:'client-a',clientName:'Acme Studio',contact:'Alex Morgan',companyName:'Acme Studio',role:'Social Media Manager',email:'alex@acmestudio.example',employmentType:'Part time'},
        {id:'client-b',clientName:'Northstar Digital Strategy and Marketing',role:'Virtual Assistant',email:'hello@northstardigital.example',employmentType:'Full time'},
        {id:'client-c',clientName:'Bluebird Creative',role:'Marketing Assistant',contractStatus:'Contract Ended',email:'team@bluebird.example'}
      ].map(renderActiveClientCard).join('');
    `});
    await page.evaluate(() => { renderWallet(); renderSubscriptions(); });
    await page.evaluate(() => { previewView('walletView'); openWorkspaceCalculator(); });
    await page.getByText('1 USD = 60 PHP · 2026-11-13', {exact: true}).waitFor();
    await page.locator('.salary-currency-converter summary').click();
    await page.locator('#salaryConverterAmount').fill('12.50');
    assert.match(await page.locator('#salaryConverterResult').textContent(), /750\.00/);
    await page.locator('#salaryCalculatorCurrency').selectOption('EUR');
    assert.match(await page.locator('#salaryConverterResult').textContent(), /937\.50/);
    await page.locator('#salaryCalculatorTarget').selectOption('JPY');
    assert.match(await page.locator('#salaryConverterResult').textContent(), /2,343\.75/);
    await page.keyboard.press('Escape');
    await page.locator('#salaryCalculatorPanel #workspaceCalculator').waitFor({state:'attached'});
    assert.ok(await page.locator('#walletView').isVisible());
    for (const [view, selectors] of [
      ['dashboardView', ['clientDashboardStatusFilter']],
      ['applicationsView', ['applicationDateSort', 'applicationOrderSort', 'statusFilter', 'platformFilter', 'applicationEmploymentFilter']],
      ['inboxView', ['emailDateSort']],
      ['hiredView', ['hiredDateSort', 'hiredStatusFilter']],
      ['subscriptionsView', ['subscriptionFilter']]
    ]) {
      await page.evaluate(({view, selectors}) => {
        previewView(view);
        selectors.forEach(id => {
          const select = document.getElementById(id);
          if (!select.nextElementSibling?.matches('.application-select-trigger')) enhanceWorkspaceSelect(select, { labelText: id });
        });
      }, {view, selectors});
      for (const id of selectors) {
        const trigger = page.locator(`#${id} + .application-select-trigger`);
        assert.ok(await trigger.isVisible(), id);
        const arrow = await trigger.evaluate(button => {
          const style = getComputedStyle(button, '::after');
          return { content: style.content, align: style.alignSelf, width: style.width, height: style.height };
        });
        assert.deepEqual(arrow, { content: '""', align: 'center', width: '5px', height: '5px' }, id);
      }
    }
    await page.evaluate(() => {
      previewView('inboxView');
      $('#gmailSyncSummary').hidden = false;
      $('#emailAiStatusTrigger').parentElement.hidden = false;
      $('#emailSelectionActions').innerHTML = '<button class="button button-secondary email-selection-trigger">Select emails</button>';
    });
    const inboxControlHeights = await page.locator('#gmailSyncSummary, #emailAiStatusTrigger, .email-selection-trigger').evaluateAll(controls => controls.map(control => control.getBoundingClientRect().height));
    assert.deepEqual(inboxControlHeights, [28, 28, 28]);
    await page.evaluate(() => previewView('subscriptionsView'));
    await page.locator('#subscriptionFilter + .application-select-trigger').click();
    await page.getByRole('option', {name:'Active',exact:true}).click();
    assert.equal(await page.locator('#subscriptionFilter').inputValue(), 'active');
    await page.locator('[data-subscription-status="active"]').click();
    await page.evaluate(() => previewView('subscriptionsView'));
    const expiringFilter = page.locator('[data-subscription-status="soon"]');
    await expiringFilter.click();
    assert.equal(await expiringFilter.getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    assert.equal(await expiringFilter.getAttribute('aria-pressed'), 'false');
    await page.locator('.subscription-card-menu summary').click();
    assert.ok(await page.getByRole('button', { name: 'Renew', exact: true }).isVisible());
    await page.locator('.subscription-card-menu summary').click();
    await page.evaluate(() => { previewView('dailyTaskView'); renderDailyTasks(); });
    assert.equal(await page.locator('.dashboard-switcher').isVisible(), false);
    assert.equal(await page.locator('#dailyTaskSearch').isVisible(), false);
    assert.ok(await page.locator('#openDailyTaskAddModal').evaluate(button => getComputedStyle(button).backgroundColor === getComputedStyle(button.closest('.panel')).backgroundColor));
    assert.ok((await page.locator('.daily-task-history-panel').boundingBox()).height < 64, 'Collapsed History stays compact');
    const shellSource = fs.readFileSync(path.join(root, 'js/modules/pages/06-shell-events.js'), 'utf8');
    const shortcutStart = shellSource.indexOf("  document.addEventListener('keydown', event => {\n    if ((event.ctrlKey");
    assert.ok(shortcutStart >= 0);
    await page.addScriptTag({ content: `{
      const activeView = 'daily-task';
      const showView = () => { throw new Error('Daily task shortcut changed the route'); };
      const openClientModal = () => { throw new Error('Daily task shortcut opened an application'); };
      ${shellSource.slice(shortcutStart, shellSource.indexOf("  $$('.nav-link')", shortcutStart))}
    }` });
    await page.getByRole('button', { name: 'Next day' }).click();
    assert.equal(await page.locator('#dailyTaskDate').inputValue(), '2026-11-06');
    await page.locator('[data-follow-up-calendar="dailyTaskDate"]').click();
    await page.locator('#dailyTaskDateCalendar [data-calendar-date="2026-11-07"]').click();
    assert.equal(await page.locator('#dailyTaskDate').inputValue(), '2026-11-07', 'Daily tasks allow weekend dates');
    await page.locator('.daily-task-history-heading').click();
    assert.ok(await page.locator('#dailyTaskHistoryList').isVisible());
    await page.evaluate(() => {
      data.dailyTasks = [
        { id: 'task-a', title: 'First task', taskDate: '2026-11-07' },
        { id: 'task-b', title: 'Second task', taskDate: '2026-11-07' }
      ];
      renderDailyTasks();
    });
    await page.locator('#toggleDailyTaskSearch').click();
    assert.ok(await page.locator('#dailyTaskSearch').isVisible());
    await page.locator('#toggleDailyTaskSearch').click();
    await page.keyboard.press('n');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'dailyTaskQuickAdd');
    await page.locator('.daily-task-row-open[data-daily-task-open="task-a"]').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.dailyTaskOpen), 'task-b');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#dailyTaskProgressLabel').textContent(), '1/2');
    assert.equal(await page.locator('.daily-task-completed').getAttribute('open'), null);
    await page.locator('[data-task-filter="completed"]').click();
    assert.ok(await page.locator('.daily-task-completed .daily-task-row-open').isVisible());
    const tools = ['cover-letter', 'scripts', 'templates', 'documents', 'links', 'invoices', 'salary'];
    const views = ['dashboardView','dailyTaskView','applicationsView','toApplyView','inboxView','documentsView','walletView','subscriptionsView','newsView','socialTrendsView','hiredView'];
    for (const width of process.env.DASHBOARD_ONLY ? [] : [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        for (const view of views) {
          await page.evaluate(view => previewView(view), view);
          if (view === 'subscriptionsView') {
            const searchAboveCounts = await page.locator('.subscriptions-toolbar').evaluate(toolbar =>
              toolbar.getBoundingClientRect().bottom <= document.querySelector('#subscriptionSummary').getBoundingClientRect().top
            );
            assert.ok(searchAboveCounts, 'Subscription search and filter sit above the summary cards.');
          }
          const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
          assert.ok(metrics.scroll <= metrics.width + 1, `${view} ${width}/${theme}: page overflow ${metrics.scroll}`);
          const header = await page.locator('.topbar').evaluate(el => {
            const title=document.querySelector('#pageTitle'), t=title.getBoundingClientRect();
            const contexts=[...el.querySelectorAll('.page-context:not([hidden])')].filter(node=>getComputedStyle(node).display!=='none');
            return { font:parseFloat(getComputedStyle(title).fontSize), height:el.getBoundingClientRect().height,
              stacked:contexts.every(node=>node.getBoundingClientRect().top>=t.bottom-1) };
          });
          assert.ok(header.font<=20, `${view} ${width}: title stays compact (${header.font}px)`);
          assert.ok(header.stacked, `${view} ${width}: context sits below the title`);
          if(width>=1100) assert.ok(header.height<=82, `${view}: compact desktop header (${header.height}px)`);
          if(view==='hiredView' && width<=720) assert.ok(header.height<=90, `Client list header stays compact (${header.height}px)`);
          const collisions = await page.locator('.topbar').evaluate(el => {
            const nodes=[...el.querySelectorAll('#pageTitle, #openQuickSearch, #notificationButton, #openAddModal, #openFollowUpTemplate, .dashboard-switcher')]
              .filter(node=>node.checkVisibility());
            return nodes.flatMap((a,i)=>nodes.slice(i+1).filter(b=>{
              const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();
              return Math.min(x.right,y.right)-Math.max(x.left,y.left)>1 && Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1;
            }).map(b=>a.id+' overlaps '+(b.id||b.className)));
          });
          assert.deepEqual(collisions, [], `${view} ${width}: header controls do not overlap`);
          if (width <= 600) assert.ok((await page.locator('.content').boundingBox()).width >= width - 2, `${view}: mobile canvas uses the available width`);
          if (view === 'dashboardView') {
            await page.evaluate(() => { $('#clientDashboardPanel').hidden = true; $('#applicationDashboardPanel').hidden = false; });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Application dashboard fits ${width}/${theme}`);
            await page.evaluate(() => { $('#clientDashboardPanel').hidden = false; $('#applicationDashboardPanel').hidden = true; });
          }
          if (view === 'documentsView') {
            for (const tool of tools) {
              if (width <= 900) await page.locator('#careerToolSelect').selectOption(tool);
              else await page.locator('[data-documents-tab="' + tool + '"]').click();
              assert.equal(await page.locator('[data-documents-panel]:not([hidden]):not(.hidden)').count(), 1);
              assert.equal(await page.locator('[data-documents-tab="'+tool+'"]').getAttribute('aria-selected'), 'true');
              assert.ok(await page.locator('#careerToolDescription').textContent());
              assert.equal(await page.locator('#careerToolSelect').inputValue(), tool);
              const overflow = await page.locator('.career-tool-content').evaluate(el => el.scrollWidth > el.clientWidth + 1);
              assert.equal(overflow, false, `Tool overflow: ${tool} at ${width}/${theme}`);
              if (width > 900) {
                const fits = await page.locator('.career-tool-content').evaluate(el =>
                  el.getBoundingClientRect().bottom <= innerHeight + 1 && document.documentElement.scrollHeight <= innerHeight + 1);
                assert.ok(fits, `${tool} fits the desktop viewport at ${width}/${theme}`);
              }
            }
          }
        }
      }
      // The shared sidebar stays identical in list and detail mode.
      const sidebarSnapshot = () => page.evaluate(() => {
        const selected=document.querySelector('.sidebar .nav-link.active');
        return [...document.querySelectorAll('.sidebar, .sidebar-brand-row, .sidebar .nav-group-label, .sidebar .nav-link')].map(el=>{
          const s=getComputedStyle(el),r=el.getBoundingClientRect();
          return [r.x,r.y,r.width,r.height,s.padding,s.margin,s.fontFamily,s.fontSize,s.borderRadius];
        }).concat(selected ? [[getComputedStyle(selected).backgroundColor,getComputedStyle(selected).boxShadow]] : []);
      });
      await page.evaluate(() => previewView('documentsView'));
      const sharedSidebar = await sidebarSnapshot();
      // Client detail content and header must retain their original design.
      await page.evaluate(() => previewView('hiredView'));
      assert.deepEqual(await sidebarSnapshot(), sharedSidebar, `Same sidebar on client list at ${width}`);
      await page.evaluate(()=>{
        $('#hiredView').classList.add('client-focused'); $('#hiredView > .toolbar').hidden=true;
        $('#hiredList').closest('.hired-panel').hidden=true; $('#hiredDetailPanel').classList.remove('hidden');
        $('#hiredHeaderSummary').hidden=true; $('#hiredCountLabel').hidden=true;
      });
      assert.deepEqual(await sidebarSnapshot(), sharedSidebar, `Same sidebar on client details at ${width}`);
      const snapshot = () => page.evaluate(() => [...document.querySelectorAll('#hiredView, #hiredView *, .content, .topbar, .topbar *')].map(el => {
        const s=getComputedStyle(el), r=el.getBoundingClientRect();
        return [r.x,r.y,r.width,r.height,s.display,s.padding,s.margin,s.color,s.backgroundColor,s.borderRadius,s.fontSize,s.fontWeight,s.boxShadow];
      }));
      const withRefresh = await snapshot();
      await page.evaluate(() => document.querySelector('link[href*="modern-workspace.css"]').sheet.disabled = true);
      assert.deepEqual(await snapshot(), withRefresh, `Client details unchanged at ${width}`);
      await page.evaluate(() => document.querySelector('link[href*="modern-workspace.css"]').sheet.disabled = false);
    }
    if (!process.env.DASHBOARD_ONLY) {
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>{previewView('hiredView');document.documentElement.dataset.theme='light'});
    await page.screenshot({path:path.join(output,'client-list-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(output,'client-list-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(() => { previewView('documentsView'); document.documentElement.dataset.theme='light'; selectCareerTool('cover-letter'); });
    await page.locator('[data-documents-tab="cover-letter"]').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('[data-documents-tab="scripts"]').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('End');
    assert.equal(await page.locator('#careerToolSelect').inputValue(), 'salary');
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#careerToolSelect').inputValue(), 'cover-letter');
    await page.locator('[data-cover-letter-field="company"]').fill('Acme Studio');
    assert.ok((await page.locator('#coverLetterPreview').textContent()).includes('Acme Studio'));
    await page.screenshot({path:path.join(output,'career-tools-desktop.png'),fullPage:true});
    await page.evaluate(()=>selectCareerTool('salary'));
    await page.locator('#salaryCalculatorRate').fill('20');
    assert.equal(await page.locator('#salaryCalculatorMonthlyTotal').textContent(), '$3,467');
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(output,'career-tools-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    for (const view of ['dashboardView','dailyTaskView','applicationsView','inboxView','walletView','subscriptionsView','newsView','hiredView']) {
      await page.evaluate(view=>previewView(view),view);
      await page.screenshot({path:path.join(output,view+'.png'),fullPage:true});
    }
    await page.evaluate(() => { previewView('dashboardView'); $('#clientDashboardPanel').hidden=true; $('#applicationDashboardPanel').hidden=false; });
    await page.screenshot({path:path.join(output,'application-dashboard.png'),fullPage:true});
    }
    await page.setViewportSize({width:1440,height:739});
    const overview = await page.evaluate(() => {
      previewView('dashboardView');
      $('#recentApplications').innerHTML = Array.from({length:5}, (_,i)=>'<tr><td>Company '+(i+1)+'</td><td>LinkedIn</td><td>Applied</td><td>Nov 5</td><td><button class="icon-button list-icon-button" aria-label="Edit application">↗</button></td></tr>').join('');
      $('#interviewCalendar').innerHTML = Array.from({length:49}, (_,i)=>'<div class="calendar-day"><span class="calendar-day-number">'+(i%30+1)+'</span></div>').join('');
      $('#clientDashboardTableBody').innerHTML = Array.from({length:3}, (_,i)=>'<tr><td>Client '+(i+1)+'</td><td>Active</td><td>Nov 1, 2026</td><td>Nov 30, 2026</td><td>$12 / hour</td></tr>').join('');
      $('#clientDashboardActivityList').innerHTML = Array.from({length:5}, (_,i)=>'<article class="client-dashboard-activity-item"><span class="client-dashboard-activity-icon">✓</span><span><strong>Updated client '+(i+1)+'</strong><small>Reviewed the client campaign</small></span><time>Oct 27, 2026</time></article>').join('');
      $('#clientDashboardAttentionList').innerHTML = '<article class="client-dashboard-attention-item"><span class="client-dashboard-attention-dot"></span><span class="client-dashboard-attention-copy"><strong>Follow-up due</strong><small>Last contacted Oct 20, 2026</small></span><button class="button button-secondary">Message</button></article>';
      $('#clientDashboardTaskList').innerHTML = '<p class="dashboard-compact-empty">No open client tasks.</p>';
      $('#clientDashboardHoursChart').parentElement.hidden = true;
      $('#clientDashboardHoursEmpty').hidden = false;
      $('#applicationProgressAiResult').hidden = false;
      $('#weeklyReportPeriod').textContent = 'Nov 9 – Nov 13, 2026';
      $('#applicationProgressAiStatus').textContent = 'Showing your saved review. It is kept for 24 hours on this browser. Choose Review again to include newer activity.';
      $('#applicationProgressAiResult').innerHTML = '<p>Needs attention · Reviewed 11/13/2026, 11:04 AM</p><p class="application-progress-ai-summary">Activity is not improving. The highest priority is to address the low number of applications and the lack of matched replies.</p><details class="dashboard-view-all"><summary>Read more</summary><p>Review outstanding applications.</p></details>';
      return ['client','application'].map(tab => {
        $('#clientDashboardPanel').hidden=tab!=='client';
        $('#applicationDashboardPanel').hidden=tab!=='application';
        $('#pageTitle').textContent=tab==='client'?'Client Dashboard':'Application Dashboard';
        const {x,y} = $('.dashboard-switcher').getBoundingClientRect();
        const panel = $('#'+tab+'DashboardPanel');
        return {x,y,height:document.documentElement.scrollHeight, bottom:panel.getBoundingClientRect().bottom, panels: [...panel.querySelectorAll('.panel, .client-dashboard-panel, .stat-grid, .weekly-report-banner')].filter(el=>el.checkVisibility()).map(el=>[el.className,Math.round(el.getBoundingClientRect().top),Math.round(el.getBoundingClientRect().height)])};
      });
    });
    assert.equal(overview[0].x, overview[1].x, JSON.stringify(overview));
    assert.equal(overview[0].y, overview[1].y, 'The switcher keeps its vertical position');
    assert.ok(overview.every(view => view.height <= 740), JSON.stringify(overview));
    await page.setViewportSize({width:1425,height:720});
    const applicationFit = await page.evaluate(() => {
      const panel = document.querySelector('#applicationDashboardPanel');
      return { viewport: innerHeight, document: document.scrollingElement.scrollHeight, bottom: panel.getBoundingClientRect().bottom };
    });
    assert.ok(applicationFit.document <= applicationFit.viewport && applicationFit.bottom <= applicationFit.viewport, JSON.stringify(applicationFit));
    // Stress both overviews with enough records to require the page to grow.
    await page.evaluate(() => {
      $('#clientDashboardTableBody').innerHTML = Array.from({length:20}, (_,i)=>'<tr><td>Client '+(i+1)+'</td><td>Active</td><td>Nov 1, 2026</td><td>Nov 30, 2026</td><td>$12 / hour</td><td><button class="client-dashboard-row-action">View</button></td></tr>').join('');
      $('#clientDashboardTaskList').innerHTML = Array.from({length:20}, (_,i)=>'<div class="client-dashboard-task-item">Prepare campaign '+(i+1)+'</div>').join('');
      $('#clientDashboardActivityList').innerHTML = Array.from({length:20}, (_,i)=>'<div class="client-dashboard-activity-item">Updated client '+(i+1)+'</div>').join('');
      $('#recentApplications').innerHTML = Array.from({length:20}, (_,i)=>'<tr><td>Company '+(i+1)+'</td><td>LinkedIn</td><td>Applied</td><td>Nov 5</td><td>View</td></tr>').join('');
      $('#interviewCalendar').innerHTML = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>'<div class="calendar-weekday">'+day+'</div>').join('') + Array.from({length:42},(_,i)=>'<div class="calendar-day">'+(i%30+1)+'</div>').join('');
      $('#interviewCalendarMonth').textContent='November 2026';
      $('#applicationProgressAiResult').hidden=false;
      $('#applicationProgressAiResult').innerHTML='<h3>Your next steps</h3>'+Array.from({length:15},()=>'<p>Review your applications and prepare a follow-up.</p>').join('');
      $('.client-dashboard-stat-grid').classList.add('has-income');
      $('#clientDashboardIncomeCard').hidden=false;
      $('#clientDashboardIncome').textContent='₱42,000';
    });
    for (const size of [{width:1920,height:1080},{width:1440,height:900},{width:1366,height:680},{width:1280,height:600},{width:1024,height:720},{width:1000,height:600},{width:390,height:844}]) {
      await page.setViewportSize(size);
      for (const tab of ['client','application']) {
        await page.evaluate(tab=>{
          previewView('dashboardView');
          $('#clientDashboardPanel').hidden=tab!=='client'; $('#applicationDashboardPanel').hidden=tab!=='application';
          $('#pageTitle').textContent=tab==='client'?'Client Dashboard':'Application Dashboard';
        },tab);
        assert.ok(await page.locator('.dashboard-switcher').isVisible());
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${tab}: dashboard fits the viewport width`);
        if (tab === 'application') {
          const layout = await page.locator('.application-dashboard-main').evaluate(el => {
            const recent = el.querySelector('.recent-panel');
            const list = recent.querySelector('table');
            const charts = el.querySelector('#applicationOverviewCarousel');
            const panel = el.parentElement;
            const main = el.getBoundingClientRect();
            const insights = panel.querySelector('.application-dashboard-insights').getBoundingClientRect();
            return {
              mainWidth: main.width,
              panelWidth: panel.clientWidth,
              sameRow: Math.abs(main.top - insights.top) < 1,
              stacked: insights.top >= main.bottom,
              minCardWidth: Math.min(...[...el.querySelectorAll('.stat-card')].map(card => card.getBoundingClientRect().width)),
              statHeight: el.querySelector('.stat-card').getBoundingClientRect().height,
              gap: recent.getBoundingClientRect().top - charts.getBoundingClientRect().bottom,
              listFits: list.getBoundingClientRect().bottom < recent.getBoundingClientRect().bottom
            };
          });
          assert.ok(layout.statHeight < 125 && layout.gap >= 0 && layout.gap <= 24 && layout.listFits, JSON.stringify(layout));
          assert.ok(layout.minCardWidth >= 80 && (size.width >= 1100
            ? layout.sameRow && layout.mainWidth >= layout.panelWidth * .55
            : layout.stacked && layout.mainWidth >= layout.panelWidth - 2), JSON.stringify({ size, ...layout }));
        } else {
          const attention = await page.locator('.client-dashboard-attention').boundingBox();
          assert.ok(attention.height < 160, 'An empty attention panel stays compact');
        }
        const fit = await page.evaluate(tab=>{
          const selectors=tab==='client'?'.client-dashboard-stat-grid, .client-dashboard-main-grid > section, .client-dashboard-bottom-grid > section':'.weekly-report-banner, #applicationDashboardPanel > .stat-grid, #applicationOverviewCarousel, .recent-panel, .application-dashboard-insights > section';
          const nodes=[...document.querySelectorAll(selectors)].filter(el=>el.checkVisibility());
          return {page:document.documentElement.scrollHeight, viewport:innerHeight,
            panels:nodes.map(el=>{const r=el.getBoundingClientRect();return {name:el.className,top:r.top,bottom:r.bottom,height:r.height}})};
        },tab);
        assert.ok(fit.page > fit.viewport, `${tab} dashboard grows to accommodate long content`);
        for (const panel of fit.panels) {
          assert.ok(panel.bottom <= fit.page + 1, `${tab} panel fits the document: ${panel.name}`);
          assert.ok(panel.height>=(panel.name.includes('weekly-report-banner')?48:panel.name.includes('stat-grid')?64:80), `${tab} panel remains usable: ${panel.name} (${panel.height}px)`);
        }
        if(size.width===1366) await page.screenshot({path:path.join(output,'dashboard-fit-'+tab+'.png')});
        if(size.width===1024) await page.screenshot({path:path.join(output,'dashboard-small-'+tab+'.png')});
        const scrollable = await page.locator(tab==='client'?'.client-dashboard-table-wrap':'.application-progress-ai').evaluate(el=>({overflow:getComputedStyle(el).overflowY,height:el.clientHeight,content:el.scrollHeight}));
        assert.ok(scrollable.content <= scrollable.height + 1, `${tab}: growing content is fully visible within its panel`);
        if(tab==='client') assert.ok(await page.locator('.client-dashboard-stat-grid').evaluate(el=>[...el.querySelectorAll('.client-dashboard-kpi:not([hidden])')].every(card=>[...card.children].every(child=>child.getBoundingClientRect().bottom<=card.getBoundingClientRect().bottom))), 'Client KPI text stays inside its cards');
      }
    }
    assert.deepEqual(errors, [], 'No browser runtime errors');
    if (!process.env.DASHBOARD_ONLY) console.log('PASS modern workspace: 11 pages, 5 widths, light/dark, compact headers, stacked dates, 7 career tools, live updates, and unchanged client details.');
    console.log('PASS both dashboards: desktop and mobile widths, panels grow to fit long lists and AI reviews.');
    console.log('Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
