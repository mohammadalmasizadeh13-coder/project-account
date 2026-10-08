import assert from 'node:assert/strict';

export async function checkGoldBalancePurchase({ evaluate, ready, until, go, fill, click, resize, screenshot, workspace }) {
  const invoice = '[data-partner-invoice]';
  const row = '[data-partner-line="0"]';
  const openTool = async (section, tool) => {
    if (await evaluate(`document.querySelector('.workspace-rail')?.getAttribute('aria-hidden') === 'true'`)) await click('.workspace-menu-toggle');
    await click(`[data-section="${section}"]`);
    await click(`[data-tool="${tool}"]`);
  };
  const openBalance = async () => {
    await openTool('reports', 'balance');
    await ready('[data-testid="gold-purchased"]');
  };
  const openBalancePurchase = async () => {
    await openBalance();
    await click('[data-gold-balance-purchase]');
    await ready(invoice);
    assert.equal(await evaluate(`document.querySelector('[data-document-type]').value`), 'partner-melted-purchase');
  };
  const purchasedGrams = () => evaluate(`Number(document.querySelector('[data-testid="gold-purchased"]').textContent.replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)).replace(/٫/g, '.').replace(/[^0-9.]/g, ''))`);
  const fillRow = async values => {
    for (const [name, value] of Object.entries(values)) await fill(`${row} [name="${name}"]`, value);
  };
  const saveInvoice = async () => {
    await click('[data-partner-invoice-save]');
    await until(`document.querySelector('.partner-crm .form-message.success')`);
  };
  const ordinaryNote = 'پیش‌نویس خرید عادی آب‌شده';
  const balanceNote = 'خرید آب‌شده برای تکمیل تراز طلا با مشخصات کامل';

  // A purchase started from the balance must keep its purpose and draft separate.
  await openTool('entries', 'partner-melted-purchase');
  await ready(invoice);
  await fill(`${invoice} [name="note"]`, ordinaryNote);
  await openBalance();
  const beforePurchased = await purchasedGrams();
  const before = (await workspace()).data;
  await click('[data-gold-balance-purchase]');
  await ready(invoice);
  assert.equal(await evaluate(`document.querySelector('[data-document-type]').value`), 'partner-melted-purchase');
  assert.equal(await evaluate(`document.querySelector('${invoice} [name="note"]').value`), '');
  for (const name of ['date', 'externalInvoiceNumber', 'gold18Price', 'note', 'paidGold', 'paidToman', 'referenceName', 'refNumber']) {
    await ready(`${invoice} [name="${name}"]`);
  }
  for (const name of ['itemName', 'itemCount', 'weightMode', 'meltedWeight', 'meltedAyar', 'meltedFee', 'assayCode', 'laboratoryName']) {
    await ready(`${row} [name="${name}"]`);
  }
  await fill(`${invoice} [name="gold18Price"]`, '20000000');
  await fill(`${invoice} [name="externalInvoiceNumber"]`, 'BALANCE-210');
  await fill(`${invoice} [name="note"]`, balanceNote);
  await fillRow({ itemName: 'آب‌شده خرید تراز', itemCount: '۲', weightMode: 'total', meltedWeight: '۱۲', meltedAyar: '۹۰۰', meltedFee: '۱۱۰۰۰۰۰۰۰', assayCode: 'BALANCE-900', laboratoryName: 'آزمایشگاه خرید تراز', wagePercent: '۰', profitPercent: '۰' });

  await go('/account'); await ready('.workspace-page');
  await openBalancePurchase();
  assert.equal(await evaluate(`document.querySelector('${invoice} [name="note"]').value`), balanceNote);
  assert.equal(await evaluate(`document.querySelector('${row} [name="itemCount"]').value`), '2');
  assert.equal(await evaluate(`document.querySelector('${row} [name="meltedWeight"]').value`), '12');
  assert.equal(await evaluate(`document.querySelector('${row} [name="assayCode"]').value`), 'BALANCE-900');
  await resize(390, 844);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
  await screenshot('gold-balance-partner-purchase-mobile', '[data-partner-document-entry]');
  await resize(1440);
  await saveInvoice();

  const after = (await workspace()).data;
  const saved = after.documents.find(document => document.externalInvoiceNumber === 'BALANCE-210');
  assert.ok(saved, 'Balance purchase created a stock document');
  assert.equal(after.documents.length, before.documents.length + 1);
  assert.equal(saved.type, 'melted-purchase');
  assert.equal(saved.source, 'partner-invoice');
  assert.equal(saved.goldBalancePurchase, true);
  assert.equal(Number(saved.itemCount), 2);
  assert.equal(Number(saved.totalWeight750), 14.4);
  assert.equal(saved.assayCode, 'BALANCE-900');
  assert.equal(saved.laboratoryName, 'آزمایشگاه خرید تراز');
  const entry = after.partners.find(partner => partner.id === saved.partnerId).entries.find(entry => entry.documentIds?.includes(saved.id));
  assert.ok(entry);
  assert.equal(entry.note, balanceNote);
  assert.deepEqual(after.goldPurchases, before.goldPurchases, 'The stock document must not also create a manual balance purchase');
  await openBalance();
  assert.equal(await purchasedGrams(), beforePurchased + 14.4);
  await go('/account'); await ready('.workspace-page');
  await openBalance();
  assert.equal(await purchasedGrams(), beforePurchased + 14.4);
  assert.equal((await workspace()).data.documents.find(document => document.id === saved.id).goldBalancePurchase, true);

  // Ordinary purchases retain their own draft and do not acquire the balance tag.
  await openTool('entries', 'partner-melted-purchase');
  await ready(invoice);
  assert.equal(await evaluate(`document.querySelector('${invoice} [name="note"]').value`), ordinaryNote);
  assert.equal(await evaluate(`document.querySelector('${row} [name="assayCode"]').value`), '');
  await fill(`${invoice} [name="gold18Price"]`, '20000000');
  await fill(`${invoice} [name="externalInvoiceNumber"]`, 'ORDINARY-211');
  await fillRow({ itemName: 'آب‌شده خرید عادی', itemCount: '۱', weightMode: 'total', meltedWeight: '۲', meltedAyar: '۷۵۰', meltedFee: '۱۱۰۰۰۰۰۰۰', assayCode: 'ORDINARY-750', laboratoryName: 'آزمایشگاه خرید عادی', wagePercent: '۰', profitPercent: '۰' });
  await saveInvoice();
  const ordinary = (await workspace()).data.documents.find(document => document.externalInvoiceNumber === 'ORDINARY-211');
  assert.ok(ordinary);
  assert.notEqual(ordinary.goldBalancePurchase, true);
  await openBalance();
  assert.equal(await purchasedGrams(), beforePurchased + 14.4);
  console.log('Gold balance browser checks passed: partner melted purchase navigation, complete specifications, isolated drafts, mobile layout, save/reload, actual 750 weight, no duplicate purchase, and ordinary purchase isolation.');
}
