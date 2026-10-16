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
  escapeHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  hiredClients: () => [], isActiveContract: () => true,
  toast() {}, persist: async () => { saves++; return true; }, appConfirm: async () => confirmed
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules/03a-invoice-payments.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules/pages/14-wallet-page.js'), 'utf8'), context);
const totals = context.walletTotals([
  { account: 'maribank', type: 'opening', cents: 10000 },
  { account: 'wise', type: 'salary', cents: 250000 },
  { account: 'gcash', type: 'income', cents: 1500 },
  { account: 'gcash', type: 'expense', cents: 2000 },
  { account: 'unknown', type: 'income', cents: 500 },
  { account: 'wise', type: 'salary', cents: NaN }
]);
assert.equal(totals.balance, 259500);
assert.equal(totals.income, 1500);
assert.equal(totals.salary, 250000);
assert.equal(totals.accounts.gcash, -500);
assert.equal(context.walletTotals([]).balance, 0);

async function submit(amount, type = 'income', account = 'wise') {
  node('#walletEntryAmount').value = amount;
  node('#walletEntryType').value = type;
  node('#walletEntryAccount').value = account;
  node('#walletEntryDate').value = '2026-10-16';
  node('#walletEntryDescription').value = '<script>example</script>';
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
  node('#walletAccountFilter').value = 'wise';
  context.renderWallet();
  assert.ok(node('#walletTransactionList').innerHTML.includes('No transactions yet'));
  const removeEvent = { target: { closest: selector => selector === '[data-wallet-delete]' ? { dataset: { walletDelete: id } } : null } };
  confirmed = false;
  await node('#walletTransactionList').handlers.click(removeEvent);
  assert.equal(context.data.walletEntries.length, 1);
  confirmed = true;
  await node('#walletTransactionList').handlers.click(removeEvent);
  assert.equal(context.data.walletEntries.length, 0);
  assert.equal(saves, 3);
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
  assert.equal(context.data.walletEntries.length, 0);
  context.dataReady = false;
  await submit('100');
  assert.equal(saves, 3);
  console.log('Wallet checks passed, including paid invoice amounts, account mapping, missing PHP, duplicate IDs, payment edits and unpaid reversals.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
