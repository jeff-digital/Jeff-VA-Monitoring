  // --- Application/email matching ---
  const PLATFORM_SENDER_EMAILS = Object.freeze({
    '20four7va': 'info@20four7va.com',
    indeed: 'donotreply@jobalert.indeed.com',
    jobstreet: 'noreply@e.jobstreet.com',
    multiplymii: 'info@multiplymii.com',
    'onlinejobs.ph': 'support@onlinejobs.ph',
    'remote work ph': 'support@remotework.ph',
    zirtual: 'noreply@candidates.workablemail.com'
  });
  const PLATFORM_DISPLAY_NAMES = Object.freeze({
    '20four7va': '20four7VA',
    indeed: 'Indeed',
    jobstreet: 'Jobstreet',
    multiplymii: 'MultiplyMii',
    'onlinejobs.ph': 'OnlineJobs.ph',
    'remote work ph': 'Remote Work PH',
    zirtual: 'Zirtual'
  });
  let applicationEmailMatchesCache = new WeakMap();
  let applicationEmailSummaryCache = null;
  let applicationEmailSummarySource = null;
  let applicationEmailSummaryCount = 0;
  let ambiguousEmailMatches = new WeakMap();
  const GENERIC_DISAMBIGUATION_ROLE_WORDS = new Set([
    'virtual', 'assistant', 'manager', 'specialist', 'marketing', 'digital', 'remote', 'wfh', 'wfo'
  ]);
  let applicationMatchIndex = [];
  let applicationMatchIndexSignature = '';
