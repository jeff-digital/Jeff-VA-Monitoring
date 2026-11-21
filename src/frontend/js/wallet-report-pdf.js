const accountLabels = { maribank: 'MariBank', gcash: 'GCash', wise: 'Wise', unassigned: 'Unassigned' };
const validAccount = value => {
  const key = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return Object.hasOwn(accountLabels, key) ? key : 'unassigned';
};
const typeLabels = { income: 'Income', salary: 'Salary', expense: 'Expense', payable: 'Due', opening: 'Opening balance' };
const colors = {
  navy: '0.10 0.15 0.28', ink: '0.16 0.20 0.29', muted: '0.40 0.45 0.54',
  line: '0.88 0.90 0.94', tint: '0.96 0.97 0.99', white: '1 1 1',
  green: '0.12 0.47 0.34', red: '0.72 0.22 0.27', amber: '0.62 0.38 0.08',
  greenTint: '0.91 0.96 0.93', redTint: '0.99 0.92 0.92', amberTint: '1 0.96 0.87'
};

const normalizeText = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim();
const pdfLiteral = value => {
  const source = normalizeText(value);
  let result = '';
  for (const char of source) {
    const cp = char.codePointAt(0);
    const winAnsi = cp === 0x2013 ? 0x96 : cp === 0x2014 ? 0x97 : cp === 0x2022 ? 0x95 : cp === 0x2212 ? 0x2d : cp;
    if (winAnsi < 32 || winAnsi > 255) continue;
    if (winAnsi > 126) result += `\\${winAnsi.toString(8).padStart(3, '0')}`;
    else if (char === '\\' || char === '(' || char === ')') result += `\\${char}`;
    else result += String.fromCharCode(winAnsi);
  }
  return `(${result})`;
};
const money = cents => `PHP ${(Number(cents || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const centsOrZero = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
const localDate = value => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};
const formatDate = value => {
  const date = value instanceof Date ? value : localDate(value);
  return date ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date) : String(value || '—');
};
const monthLastDay = value => {
  const date = localDate(value);
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
};
const reportRangeLabel = (start, end, fallback) => {
  const first = localDate(start), last = localDate(end);
  if (!first || !last) return `Report period: ${normalizeText(fallback || 'Selected period')}`;
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' });
  const year = first.getFullYear();
  if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth() && first.getDate() === last.getDate()) return `Report period: ${formatDate(first)}`;
  if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth()) {
    return `Report period: ${month.format(first)} ${first.getDate()} – ${month.format(last)} ${last.getDate()}, ${year}`;
  }
  return `Report period: ${formatDate(first)} – ${formatDate(last)}`;
};
const reportTitle = (title, period) => {
  let result = normalizeText(title || 'Wallet report');
  result = result.replace(/^monthly report\s*[-–·]\s*/i, 'Monthly report – ')
    .replace(/^weekly report\s*[-–·]\s*/i, 'Weekly report – ')
    .replace(/^salary report\s*[-–·]\s*/i, 'Salary report – ');
  return result === 'Wallet report' ? `Wallet report – ${normalizeText(period || '')}` : result;
};
const wrapWords = (value, maxWidth, size, maxLines = 3) => {
  const words = normalizeText(value).split(' ').filter(Boolean);
  const limit = Math.max(8, Math.floor(maxWidth / (size * 0.56)));
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= limit) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const clipped = lines.slice(0, maxLines);
    clipped[maxLines - 1] = `${clipped[maxLines - 1].replace(/[.,;:]?$/, '')}...`;
    return clipped;
  }
  return lines.length ? lines : ['—'];
};

// Shared, dependency-free PDF generator for report downloads, previews, and scheduled email attachments.
export function createWalletReportPdf({ title, period, rangeStart = '', rangeEnd = '', userName = 'Jeffrey Almocera', generatedOn = new Date(), entries = [], accountBalances = null }) {
  const validTypes = new Set(Object.keys(typeLabels));
  const safeEntries = entries.filter(item => item && validTypes.has(item.type) && (item.cents === null || (Number.isSafeInteger(item.cents) && item.cents >= 0)))
    .map(item => ({ ...item, account: validAccount(item.account), date: String(item.date || '') }))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const totals = safeEntries.reduce((sum, entry) => {
    const cents = centsOrZero(entry.cents);
    if (entry.type === 'expense') sum.expense += cents;
    else if (entry.type === 'salary') sum.salary += cents;
    else if (entry.type === 'income') sum.income += cents;
    else if (entry.type === 'payable') { sum.due += cents; sum.dueCount++; }
    return sum;
  }, { income: 0, salary: 0, expense: 0, due: 0, dueCount: 0 });
  const net = totals.income + totals.salary - totals.expense;
  const displayTitle = reportTitle(title, period);
  const parsedStart = rangeStart || safeEntries[0]?.date || '';
  const parsedEnd = rangeEnd || safeEntries[safeEntries.length - 1]?.date || '';
  const dateRange = reportRangeLabel(parsedStart, parsedEnd, period || displayTitle);
  const generatedDate = formatDate(generatedOn instanceof Date ? generatedOn : new Date(generatedOn));
  const pages = [];
  let ops = [], y = 0, rowIndex = 0;
  const text = (value, x, baseline, size = 9, color = colors.ink, font = 'F1') => ops.push({ kind: 'text', text: String(value ?? ''), x, y: baseline, size, color, font });
  const rect = (x, bottom, width, height, color) => ops.push({ kind: 'rect', x, y: bottom, width, height, color });
  const rule = (x1, y1, x2, y2, color = colors.line, width = .6) => ops.push({ kind: 'line', x1, y1, x2, y2, color, width });
  const rightText = (value, right, baseline, size = 9, color = colors.ink, font = 'F1') => {
    // Use a conservative estimate so right-aligned amounts stay inside their cells.
    const estimatedWidth = normalizeText(value).length * size * .62;
    text(value, right - estimatedWidth, baseline, size, color, font);
  };
  const fitSize = (value, width, preferred = 7.5, minimum = 5) => Math.max(minimum, Math.min(preferred, width / Math.max(1, normalizeText(value).length * .62)));
  const badge = (label, x, baseline, color, background, size = 7) => {
    const width = Math.max(27, label.length * size * .53 + 12);
    rect(x, baseline - 3, width, 15, background);
    text(label, x + 6, baseline + 1, size, color, 'F2');
  };
  function header(first) {
    const height = first ? 122 : 112;
    rect(0, 842 - height, 595, height, colors.navy);
    text('JEFF VA  /  PERSONAL FINANCE', 42, first ? 822 : 817, 8, '0.78 0.82 0.90', 'F2');
    text('Wallet report', 42, first ? 795 : 786, first ? 22 : 15, colors.white, 'F2');
    text(displayTitle, 42, first ? 772 : 764, first ? 10 : 9, '0.84 0.87 0.93');
    text(`Prepared for ${userName || 'Jeffrey Almocera'}`, 42, first ? 750 : 746, 8, '0.78 0.82 0.90');
    text(`Generated on ${generatedDate}`, 42, first ? 735 : 732, 8, '0.78 0.82 0.90');
    if (first) {
      text(dateRange, 42, 690, 8.5, colors.ink, 'F2');
      drawSummary();
      text('Transactions', 42, 566, 12, colors.navy, 'F2');
      rightText(`${safeEntries.length} item${safeEntries.length === 1 ? '' : 's'}`, 553, 566, 8, colors.muted);
      y = 548;
    } else {
      text('Transactions continued', 42, 704, 11, colors.navy, 'F2');
      y = 681;
    }
    drawTableHeader(y);
    y -= 27;
  }
  function drawSummary() {
    const cards = [
      { label: 'Other income', value: money(totals.income), color: colors.green, caption: '' },
      { label: 'Salary received', value: money(totals.salary), color: colors.green, caption: '' },
      { label: 'Expenses', value: money(totals.expense), color: colors.red, caption: '' },
      { label: 'To be paid', value: money(totals.due), color: colors.amber, caption: `${totals.dueCount} unpaid item${totals.dueCount === 1 ? '' : 's'}` },
      { label: 'Net', value: money(net), color: net < 0 ? colors.red : colors.ink, caption: '' }
    ];
    const gap = 6, width = (511 - gap * 4) / 5, bottom = 594, height = 67;
    cards.forEach((card, index) => {
      const x = 42 + index * (width + gap);
      rect(x, bottom, width, height, colors.tint);
      const labelLines = wrapWords(card.label, width - 12, 7.1, 2);
      labelLines.forEach((line, lineIndex) => text(line, x + 7, bottom + height - 13 - lineIndex * 9, 7.1, colors.muted, 'F2'));
      text(card.value, x + 7, bottom + 24, fitSize(card.value, width - 14), card.color, 'F2');
      if (card.caption) text(card.caption, x + 7, bottom + 10, 6.2, colors.muted);
    });
  }
  function drawTableHeader(top) {
    rect(42, top - 22, 511, 22, colors.tint);
    text('DATE / DUE DATE', 48, top - 14, 6.7, colors.muted, 'F2');
    text('DESCRIPTION', 125, top - 14, 6.7, colors.muted, 'F2');
    text('ACCOUNT', 318, top - 14, 6.7, colors.muted, 'F2');
    text('TYPE', 402, top - 14, 6.7, colors.muted, 'F2');
    rightText('AMOUNT', 537, top - 14, 6.7, colors.muted, 'F2');
  }
  function startTransactionPage() {
    ops = []; pages.push(ops); rowIndex = 0;
    header(false);
  }
  function drawRow(entry) {
    const baseDescription = entry.description || '—';
    const description = `${baseDescription}${entry.type === 'payable' && entry.payee && !baseDescription.toLowerCase().includes(String(entry.payee).toLowerCase()) ? ` · Pay to ${entry.payee}` : ''}`;
    const descriptionLines = wrapWords(description, 185, 7.3, 3);
    const rowHeight = Math.max(25, descriptionLines.length * 9 + 10);
    if (y - rowHeight < 78) startTransactionPage();
    const bottom = y - rowHeight;
    if (rowIndex % 2 === 1) rect(42, bottom, 511, rowHeight, '0.985 0.987 0.993');
    const baseline = y - 12;
    const dateLabel = formatDate(entry.date);
    text(entry.type === 'payable' ? `Due ${dateLabel}` : dateLabel, 48, baseline, 7.1, colors.muted);
    descriptionLines.forEach((line, index) => text(line, 125, baseline - index * 9, 7.3, colors.ink));
    text(accountLabels[entry.account] || 'Unassigned', 318, baseline, 7.2, colors.muted);
    const type = typeLabels[entry.type] || 'Due';
    const palette = entry.type === 'income' || entry.type === 'salary' ? [colors.green, colors.greenTint]
      : entry.type === 'expense' ? [colors.red, colors.redTint]
        : entry.type === 'payable' ? [colors.amber, colors.amberTint] : [colors.muted, colors.tint];
    badge(type, 402, baseline - 1, palette[0], palette[1], 6.6);
    const amount = entry.cents === null ? 'Needs PHP amount' : `${entry.type === 'income' || entry.type === 'salary' ? '+' : entry.type === 'expense' ? '−' : ''}${money(entry.cents)}`;
    const amountSize = entry.cents === null ? 6.2 : fitSize(amount, 88, 7.2, 5.2);
    rightText(amount, 537, baseline, amountSize, entry.cents === null ? colors.muted : palette[0], 'F2');
    rule(42, bottom, 553, bottom);
    y = bottom;
    rowIndex++;
  }
  function drawTotalsFooter() {
    const needed = 84;
    if (y - needed < 70) startTransactionPage();
    y -= 8;
    text('Period totals', 48, y, 8, colors.muted, 'F2');
    y -= 12;
    const parts = [
      { label: 'Income', value: money(totals.income), color: colors.green },
      { label: 'Salary', value: money(totals.salary), color: colors.green },
      { label: 'Expenses', value: money(totals.expense), color: colors.red },
      { label: 'Total due', value: money(totals.due), color: colors.amber }
    ];
    const gap = 6, cellWidth = (511 - gap * (parts.length - 1)) / parts.length, cardHeight = 38;
    parts.forEach((part, index) => {
      const x = 42 + index * (cellWidth + gap);
      rect(x, y - cardHeight + 2, cellWidth, cardHeight, colors.tint);
      text(part.label, x + 8, y - 10, 6.8, colors.muted, 'F2');
      rightText(part.value, x + cellWidth - 16, y - 27, fitSize(part.value, cellWidth - 24, 7, 5), part.color, 'F2');
    });
    rule(42, y - cardHeight - 7, 553, y - cardHeight - 7, colors.line, .7);
    y -= cardHeight + 16;
  }

  ops = []; pages.push(ops); header(true);
  if (!safeEntries.length) {
    rect(42, y - 30, 511, 28, colors.tint);
    text('No transactions for this period.', 52, y - 13, 8.5, colors.muted);
    y -= 42;
  } else safeEntries.forEach(drawRow);
  drawTotalsFooter();

  const objects = [];
  const pushObj = body => { objects.push(body); return objects.length; };
  const catalogId = pushObj(''); const pagesId = pushObj('');
  const regularFontId = pushObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const boldFontId = pushObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  for (let index = 0; index < pages.length; index++) {
    const commands = pages[index].map(item => {
      if (item.kind === 'rect') return `q ${item.color} rg ${item.x} ${item.y} ${item.width} ${item.height} re f Q`;
      if (item.kind === 'line') return `q ${item.color} RG ${item.width} w ${item.x1} ${item.y1} m ${item.x2} ${item.y2} l S Q`;
      const x = `${item.x} ${item.y} Td ${pdfLiteral(item.text)} Tj ET`;
      return `BT /${item.font} ${item.size} Tf ${item.color} rg ${x}`;
    });
    const footer = `Jeff VA Wallet  |  Page ${index + 1} of ${pages.length}`;
    commands.push(`BT /F1 8 Tf ${colors.muted} rg ${Math.max(42, 553 - normalizeText(footer).length * 4.16)} 30 Td ${pdfLiteral(footer)} Tj ET`);
    const stream = commands.join('\n');
    const contentId = pushObj(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(pushObj(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(new TextEncoder().encode(pdf).length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = new TextEncoder().encode(pdf).length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export function reportLabel(period, value, salaryDescription = '') {
  if (period === 'salary') return `Salary report - ${salaryDescription || 'Selected transaction'}`;
  if (period === 'week') return `Weekly report - ${value || ''}`;
  const [year, month] = String(value || '').split('-').map(Number);
  return `Monthly report - ${year && month ? new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1)) : value || ''}`;
}

if (typeof window !== 'undefined') window.JeffWalletReportPdf = { createWalletReportPdf, reportLabel };
