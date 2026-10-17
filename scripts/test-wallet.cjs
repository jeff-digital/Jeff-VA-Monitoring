const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const nodes = new Map();
const node = selector => {
  if (!nodes.has(selector)) nodes.set(selector, { value: '', hidden: true, innerHTML: '', handlers: {}, addEventListener(name, handler) { this.handlers[name] = handler; }, focus() {}, showModal() { this.open = true; }, close() { this.open = false; }, reset() {}, reportValidity() { return true; } });
  return nodes.get(selector);
};
let saves = 0;
let confirmed = true;
const context = vm.createContext({
  $: node, data: { walletEntries: [] }, dataReady: true, supabaseDataLoaded: true, currentUser: { id: 'test' },
  Intl, crypto: require('node:crypto').webcrypto, today: () => '2026-10-16',
  formatDate: value => value,
  escapeHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  hiredClients: () => [], isActiveContract: () => true,
  toast() {}, renderAlerts() {}, persist: async () => { saves++; return true; }, appConfirm: async () => confirmed
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules/03a-invoice-payments.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules/pages/14-wallet-page.js'), 'utf8'), context);
const totals = context.walletTotals([
  { account: 'maribank', type: 'opening', cents: 10000 },
  { account: 'wise', type: 'salary', cents: 250000 },
  { account: 'gcash', type: 'income', cents: 1500 },
  { account: 'gcash', type: 'expense', cents: 2000 },
  { account: 'maribank', type: 'payable', cents: 3000 },
  { account: 'unknown', type: 'income', cents: 500 },
  { account: 'wise', type: 'salary', cents: NaN }
]);
assert.equal(totals.balance, 259500);
assert.equal(totals.income, 1500);
assert.equal(totals.salary, 250000);
assert.equal(totals.payable, 3000);
assert.equal(totals.available, 256500);
assert.equal(totals.accounts.gcash, -500);
assert.equal(totals.accounts.maribank, 10000, 'pending payments must not reduce the recorded account balance');
assert.equal(context.walletTotals([]).balance, 0);

async function submit(amount, type = 'income', account = 'wise', payee = type === 'payable' ? 'Electric company' : '') {
  node('#walletEntryAmount').value = amount;
  node('#walletEntryType').value = type;
  node('#walletEntryType').handlers.change?.();
  node('#walletEntryAccount').value = account;
  node('#walletEntryDate').value = '2026-10-16';
  node('#walletEntryDescription').value = '<script>example</script>';
  node('#walletEntryPayee').value = payee;
  await node('#walletEntryForm').handlers.submit({ preventDefault() {}, currentTarget: node('#walletEntryForm') });
}
async function main() {
  node('#walletAccountFilter').value = 'all';
  await submit('0.29');
  assert.equal(context.data.walletEntries[0].cents, 29);
  assert.equal(saves, 1);
  assert.ok(node('#walletTransactionList').innerHTML.includes('&lt;script&gt;'));
  const id = context.data.walletEntries[0].id;
  context.openWalletEntry(context.data.walletEntries[0]);
  await submit('0.10', 'expense', 'maribank');
  assert.equal(context.data.walletEntries.length, 1);
  assert.equal(context.walletTotals(context.data.walletEntries).balance, -10);
  context.openWalletEntry();
  await submit('25.00', 'payable', 'maribank');
  assert.equal(context.walletTotals(context.data.walletEntries).balance, -10);
  assert.equal(context.walletTotals(context.data.walletEntries).payable, 2500);
  assert.equal(context.walletTotals(context.data.walletEntries).available, -2510);
  assert.equal(context.data.walletEntries.find(entry => entry.type === 'payable').payee, 'Electric company');
  assert.equal(context.data.walletEntries.find(entry => entry.type === 'payable').account, 'unassigned');
  assert.equal(node('#walletAccountField').hidden, true);
  assert.equal(node('#walletEntryDateLabel').textContent, 'Payment deadline');
  assert.ok(node('#walletTransactionList').innerHTML.includes('Due'));
  assert.ok(node('#walletTransactionList').innerHTML.includes('Pay to Electric company'));
  context.openWalletEntry();
  await submit('10.00', 'payable', 'wise', '');
  assert.equal(context.data.walletEntries.length, 2, 'a pending payment must identify who will be paid');
  node('#walletAccountFilter').value = 'wise';
  context.renderWallet();
  assert.ok(node('#walletTransactionList').innerHTML.includes('No transactions yet'));
  const removeEvent = { target: { closest: selector => selector === '[data-wallet-delete]' ? { dataset: { walletDelete: id } } : null } };
  confirmed = false;
  await node('#walletTransactionList').handlers.click(removeEvent);
  assert.equal(context.data.walletEntries.length, 2);
  confirmed = true;
  await node('#walletTransactionList').handlers.click(removeEvent);
  assert.equal(context.data.walletEntries.length, 1);
  assert.equal(saves, 4);
  context.data.applications = [{ id: 'client-1', clientName: 'Test client' }];
  context.data.invoices = [
    { id: 'paid-usd', clientId: 'client-1', paidAt: '2026-10-16', paymentCurrency: 'USD', amountReceived: 100, amountReceivedPhp: 5700, paymentFee: 5, paymentMethod: 'Wise' },
    { id: 'paid-php', paidAt: '2026-10-16', paymentCurrency: 'PHP', amountReceived: 1000, paymentMethod: 'Bank transfer', walletAccount: 'maribank' },
    { id: 'missing-php', paidAt: '2026-10-16', paymentCurrency: 'USD', amountReceived: 100, paymentMethod: 'PayPal' },
    { id: 'unpaid', amountReceivedPhp: 9999 }
  ];
  let payments = context.walletInvoiceEntries();
  assert.equal(payments.length, 3);
  assert.equal(payments[0].cents, 570000); // Net PHP received; do not deduct fees again.
  assert.equal(payments[1].account, 'maribank');
  assert.equal(payments[2].cents, null); // Never assume a USD amount is PHP.
  assert.equal(context.walletTotals(payments).salary, 670000);
  context.data.invoices.push(context.data.invoices[0]);
  assert.equal(context.walletTotals(context.walletInvoiceEntries()).balance, 670000);
  context.data.invoices[0].amountReceivedPhp = 5800;
  assert.equal(context.walletTotals(context.walletInvoiceEntries()).balance, 680000);
  delete context.data.invoices[0].paidAt;
  assert.equal(context.walletTotals(context.walletInvoiceEntries()).balance, 100000);
  context.renderWallet();
  assert.ok(node('#walletInvoiceNotice').textContent.includes('1 paid invoice(s)'));
  assert.ok(node('#walletTransactionList').innerHTML.includes('No transactions yet')); // Wise filter after reversal.
  node('#walletAccountFilter').value = 'all';
  context.renderWallet();
  assert.ok(node('#walletTransactionList').innerHTML.includes('Edit payment'));
  assert.ok(node('#walletTransactionList').innerHTML.includes('Needs PHP amount'));
  context.openWalletEntry();
  await submit('-1');
  assert.equal(context.data.walletEntries.length, 1);
  context.dataReady = false;
  await submit('100');
  assert.equal(saves, 4);
  console.log('Wallet checks passed, including pending payments, available balance, paid invoice amounts, account mapping, missing PHP, duplicate IDs, payment edits and unpaid reversals.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
