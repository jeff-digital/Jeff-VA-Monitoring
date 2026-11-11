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
            hiddenData: getComputedStyle(view).opacity === '0',
            hiddenLabel: label.width <= 1 && label.height <= 1
          };
        });
        assert.ok(Object.values(loading).every(Boolean), `${route} at ${width}px: ${JSON.stringify(loading)}`);
      }
    }
    console.log(`PASS startup spinner on all ${workspaceRoutes.length} workspace routes at desktop and mobile widths.`);
    await page.goto('https://workspace-preview.test/', { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await page.addScriptTag({ content: `
      const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
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
        $('.dashboard-switcher').hidden=id!=='dashboardView';
        $('#openAddModal').hidden=id!=='applicationsView';
        $('#openFollowUpTemplate').hidden=id!=='applicationsView';
        $('#hiredHeaderSummary').hidden=id!=='hiredView';
        $('#hiredCountLabel').hidden=id!=='hiredView';
        if(id==='hiredView') { $('#hiredView').classList.remove('client-focused'); $('#hiredList').closest('.hired-panel').hidden=false; $('#hiredView > .toolbar').hidden=false; $('#hiredDetailPanel').classList.add('hidden'); }
        $$('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===$('#'+id).dataset.viewPanel));
      }
      previewView('documentsView');
    ` });
    for (const file of ['11-tools-page.js', '14-wallet-page.js', '17-subscriptions-page.js']) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/modules/pages', file), 'utf8') });
    }
    await page.evaluate(() => { renderWallet(); renderSubscriptions(); });
    // Use the production card renderer so list checks cover real markup and long names.
    const clientsSource = fs.readFileSync(path.join(root, 'js/modules/pages/09b-active-clients-render.js'), 'utf8');
    await page.addScriptTag({content: `
      const isContractEnded = item => item.contractStatus === 'Contract Ended';
      const contractEndingLabel = () => '', activeSinceDate = () => '2026-10-01', emailDate = value => value;
      const matchingEmailsForApplication = () => [], isSentEmail = () => false, clientTimeZones = new Map();
      ${clientsSource.slice(clientsSource.indexOf('  function normalizeUrl('), clientsSource.indexOf('  const hiredClientAvatarUrls'))}
      ${clientsSource.slice(clientsSource.indexOf('  function renderActiveClientCard('), clientsSource.indexOf("  $('#backToHiredList').addEventListener"))}
      $('#hiredList').innerHTML = [
        {id:'client-a',clientName:'Acme Studio',contact:'Alex Morgan',companyName:'Acme Studio',role:'Social Media Manager',email:'alex@acmestudio.example',employmentType:'Part time'},
        {id:'client-b',clientName:'Northstar Digital Strategy and Marketing',role:'Virtual Assistant',email:'hello@northstardigital.example',employmentType:'Full time'},
        {id:'client-c',clientName:'Bluebird Creative',role:'Marketing Assistant',contractStatus:'Contract Ended',email:'team@bluebird.example'}
      ].map(renderActiveClientCard).join('');
    `});
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
    // Stress both overviews with enough records to require bounded panel scrolling.
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
    for (const size of [{width:1920,height:1080},{width:1440,height:900},{width:1366,height:680},{width:1280,height:600},{width:1024,height:720},{width:1000,height:600}]) {
      await page.setViewportSize(size);
      for (const tab of ['client','application']) {
        await page.evaluate(tab=>{
          previewView('dashboardView');
          $('#clientDashboardPanel').hidden=tab!=='client'; $('#applicationDashboardPanel').hidden=tab!=='application';
          $('#pageTitle').textContent=tab==='client'?'Client Dashboard':'Application Dashboard';
        },tab);
        const fit = await page.evaluate(tab=>{
          const selectors=tab==='client'?'.client-dashboard-stat-grid, .client-dashboard-main-grid > section, .client-dashboard-bottom-grid > section':'.weekly-report-banner, #applicationDashboardPanel > .stat-grid, #applicationOverviewCarousel, .recent-panel, .application-dashboard-insights > section';
          const nodes=[...document.querySelectorAll(selectors)].filter(el=>el.checkVisibility());
          return {page:document.documentElement.scrollHeight, viewport:innerHeight,
            panels:nodes.map(el=>{const r=el.getBoundingClientRect();return {name:el.className,top:r.top,bottom:r.bottom,height:r.height}})};
        },tab);
        assert.ok(fit.page<=fit.viewport+1, `${tab} dashboard has no page scroll at ${size.width}x${size.height}: ${fit.page}`);
        for (const panel of fit.panels) {
          assert.ok(panel.top>=0 && panel.bottom<=size.height+1, `${tab} panel fits viewport: ${panel.name} (${JSON.stringify(panel)})`);
          assert.ok(panel.height>=(panel.name.includes('weekly-report-banner')?48:panel.name.includes('stat-grid')?64:80), `${tab} panel remains usable: ${panel.name} (${panel.height}px)`);
        }
        if(size.width===1366) await page.screenshot({path:path.join(output,'dashboard-fit-'+tab+'.png')});
        if(size.width===1024) await page.screenshot({path:path.join(output,'dashboard-small-'+tab+'.png')});
        const scrollable = await page.locator(tab==='client'?'.client-dashboard-table-wrap':'.application-progress-ai').evaluate(el=>({overflow:getComputedStyle(el).overflowY,height:el.clientHeight,content:el.scrollHeight}));
        assert.equal(scrollable.overflow,'auto', `${tab}: growing content remains scrollable inside its panel`);
        assert.ok(scrollable.height>40 && scrollable.content>scrollable.height, `${tab}: populated panel has an accessible scroll area`);
        if(tab==='client') assert.ok(await page.locator('.client-dashboard-stat-grid').evaluate(el=>[...el.querySelectorAll('.client-dashboard-kpi:not([hidden])')].every(card=>[...card.children].every(child=>child.getBoundingClientRect().bottom<=card.getBoundingClientRect().bottom))), 'Client KPI text stays inside its cards');
      }
    }
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log('PASS modern workspace: 11 pages, 5 widths, light/dark, compact headers, stacked dates, 7 career tools, live updates, and unchanged client details.');
    console.log('PASS both dashboards: six desktop window sizes, all panels visible, no page scrolling, and accessible overflow for long lists and AI reviews.');
    console.log('Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
