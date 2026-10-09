function containsWholeWord(haystack, needle) {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack || '');
}

function extractEmailAddress(fromHeader) {
  const match = (fromHeader || '').match(/<([^>]+)>/);
  return (match ? match[1] : (fromHeader || '')).trim().toLowerCase();
}

function extractSenderName(fromHeader) {
  return (fromHeader || '').split('<')[0].replace(/["']/g, '').trim().toLowerCase();
}

function oldMatchApplicationsForEmail(emailItem, applications) {
  const fromAddress = extractEmailAddress(emailItem.from);
  const senderName = extractSenderName(emailItem.from);
  const contentLower = `${emailItem.subject || ''} ${emailItem.body || ''}`.toLowerCase();

  return applications.filter(application => {
    const emailCandidate = (application.email || '').trim().toLowerCase();
    const contact = (application.contact || '').trim().toLowerCase();
    const clientName = (application.clientName || '').trim().toLowerCase();
    const role = (application.role || '').trim().toLowerCase();
    const roleReferenced = role.length >= 3 && contentLower.includes(role);
    const companyReferenced = clientName.length >= 3 && containsWholeWord(contentLower, clientName);
    if (emailCandidate && emailCandidate === fromAddress) return true;
    if (!roleReferenced && !companyReferenced) return false;
    return [contact, clientName].filter(name => name.length >= 3)
      .some(name => containsWholeWord(senderName, name));
  });
}

function buildApplicationMatchIndex(applications) {
  return (applications || []).map(application => {
    const email = String(application.email || '').trim().toLowerCase();
    const contact = String(application.contact || '').trim().toLowerCase();
    const clientName = String(application.clientName || '').trim().toLowerCase();
    const role = String(application.role || '').trim().toLowerCase();
    return { application, email, contact, clientName, role };
  });
}

function newMatchApplicationsForEmail(emailItem, applications) {
  const fromAddress = extractEmailAddress(emailItem.from);
  const senderName = extractSenderName(emailItem.from);
  const contentLower = `${emailItem.subject || ''} ${emailItem.body || ''}`.toLowerCase();
  const matches = [];

  for (const item of buildApplicationMatchIndex(applications)) {
    const { application, email, contact, clientName, role } = item;
    const roleReferenced = role.length >= 3 && contentLower.includes(role);
    const companyReferenced = clientName.length >= 3 && containsWholeWord(contentLower, clientName);
    if (email && email === fromAddress) {
      matches.push(application);
      continue;
    }
    if (!roleReferenced && !companyReferenced) continue;
    if ([contact, clientName].filter(name => name.length >= 3).some(name => containsWholeWord(senderName, name))) {
      matches.push(application);
    }
  }

  return matches;
}

function applicationsRelatedToEmail(emailItem, applications) {
  if (emailItem.direction !== 'sent' && emailItem.source !== 'sent') return newMatchApplicationsForEmail(emailItem, applications);
  const linkedApplication = applications.find(application => application.id === emailItem.applicationId);
  if (linkedApplication) return [linkedApplication];
  const recipient = extractEmailAddress(emailItem.to);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)
    ? applications.filter(application => (application.email || '').trim().toLowerCase() === recipient)
    : [];
}

function oldApplicationsRelatedToEmail(emailItem, applications) {
  if (emailItem.direction !== 'sent' && emailItem.source !== 'sent') return oldMatchApplicationsForEmail(emailItem, applications);
  const linkedApplication = applications.find(application => application.id === emailItem.applicationId);
  if (linkedApplication) return [linkedApplication];
  const recipient = extractEmailAddress(emailItem.to);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)
    ? applications.filter(application => (application.email || '').trim().toLowerCase() === recipient)
    : [];
}

function normalizeMatches(matches) {
  return matches.map(item => item.id || item.email || item.clientName || '').filter(Boolean).sort();
}

function runParityCase(name, emailItem, applications) {
  const oldMatches = normalizeMatches(oldMatchApplicationsForEmail(emailItem, applications));
  const newMatches = normalizeMatches(newMatchApplicationsForEmail(emailItem, applications));
  const same = JSON.stringify(oldMatches) === JSON.stringify(newMatches);
  if (!same) {
    console.error(`FAIL: ${name}`);
    console.error({ oldMatches, newMatches, emailItem, applications });
    process.exitCode = 1;
  }

  const oldRelated = normalizeMatches(oldApplicationsRelatedToEmail({ ...emailItem, direction: 'sent' }, applications));
  const newRelated = normalizeMatches(applicationsRelatedToEmail({ ...emailItem, direction: 'sent' }, applications));
  const relatedMatches = JSON.stringify(oldRelated) === JSON.stringify(newRelated);
  if (!relatedMatches) {
    console.error(`FAIL: ${name} sent-email path`);
    console.error({ oldRelated, newRelated, emailItem });
    process.exitCode = 1;
  }

  console.log(`PASS: ${name}`);
}

const applications = [
  { id: 'a1', email: 'hello@acme.com', contact: 'Maya Patel', clientName: 'Acme Labs', role: 'Senior Frontend Engineer' },
  { id: 'a2', email: 'jobs@papertrail.io', contact: 'Sam Chen', clientName: 'Papertrail', role: 'Product Designer' },
  { id: 'a3', email: 'team@regex.example', contact: 'Jane+Test', clientName: 'C++ Systems', role: 'Engineer' },
  { id: 'a4', email: '', contact: '', clientName: 'Tiny', role: 'AI' },
  { id: 'a5', email: 'boss@cycle.co', contact: 'Alex', clientName: 'Cycle Studio', role: 'Operations Manager' },
  { id: 'a6', email: 'noreply@moonworks.dev', contact: 'Nora', clientName: 'Moonworks', role: 'UX Researcher' }
];

runParityCase('direct email match', { from: 'Maya Patel <hello@acme.com>', subject: 'Interview follow-up', body: 'Thanks for the design call.' }, applications);
runParityCase('company and role in body', { from: 'The Hiring Team <careers@unknown.com>', subject: 'Senior Frontend Engineer', body: 'Acme Labs would like to set up an interview with Maya Patel.' }, applications);
runParityCase('regex special characters in names', { from: 'C++ Systems <team@regex.example>', subject: 'Engineer role', body: 'We are reviewing the C++ Systems role.' }, applications);
runParityCase('empty fields and short names', { from: 'No One <hello@example.com>', subject: 'Re: AI', body: 'Tiny team reached out about AI.' }, applications);
runParityCase('sent-email path', { to: 'hello@acme.com', subject: 'Follow-up: Acme Labs', body: 'Thanks for the interview.', direction: 'sent', source: 'sent', applicationId: 'a1' }, applications);
runParityCase('empty sender name and direct address', { from: '<hello@acme.com>', subject: '', body: '' }, applications);
runParityCase('regex chars in sender name', { from: 'Jane+Test <jobs@papertrail.io>', subject: 'Product Designer', body: 'Papertrail is interested in your design work.' }, applications);

if (!process.exitCode) {
  console.log('All matcher parity checks passed.');
}
