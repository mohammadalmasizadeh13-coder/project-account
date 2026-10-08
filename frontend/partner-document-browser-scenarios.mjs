import assert from 'node:assert/strict';

// Exercise the real forms, server ledger, modal actions, and restricted staff UI.
export async function checkPartnerDocumentActions({ cdp, evaluate, ready, until, go, fill, click, resize, screenshot, workspace }) {
  const dialog = '[data-partner-document-dialog]';
  const invoice = `${dialog} [data-partner-invoice]`;
  const settlement = `${dialog} [data-partner-settlement-form]`;
  const row = id => `[data-partner-entry="${id}"]`;
  const data = async () => (await workspace()).data;
  const partner = async () => (await data()).partners[0];
  const entry = async id => (await partner()).entries.find(saved => saved.id === id);
  const api = (path, options = {}) => evaluate(`(async () => {
    const session=await fetch('/api/auth/session').then(r=>r.json());
    const options=${JSON.stringify(options)};
    const response=await fetch(${JSON.stringify(path)}, {...options,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken||''},...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});
    return {status:response.status,body:await response.json()};
  })()`);
  const open = async type => {
    if (await evaluate(`document.querySelector('.workspace-rail')?.getAttribute('aria-hidden') === 'true'`)) await click('.workspace-menu-toggle');
    await click('[data-section="entries"]');
    await click(`[data-tool="${type}"]`);
    await ready('[data-partner-select]');
  };
  const statement = async () => {
    if (await evaluate(`document.querySelector('.workspace-rail')?.getAttribute('aria-hidden') === 'true'`)) await click('.workspace-menu-toggle');
    await click('[data-section="crm"]');
    await click('[data-crm-group="partners"]');
    await click('.partner-tabs button:first-child');
    await ready('[data-partner-statement]');
  };
  const fields = async (form, values) => {
    for (const [name, value] of Object.entries(values)) await fill(`${form} [name="${name}"]`, value);
  };
  const preview = async ({ editable = true, text = '' } = {}) => {
    await ready(`${dialog} [data-invoice-print]`);
    await until(`!document.querySelector('${invoice}') && !document.querySelector('${settlement}')`, 'Saved document returns to preview');
    assert.equal(await evaluate(`Boolean(document.querySelector('${dialog} [data-invoice-edit]'))`), editable);
    if (text) assert.equal(await evaluate(`document.querySelector('${dialog}').textContent.includes(${JSON.stringify(text)})`), true);
  };
  const close = async () => {
    await click('[data-partner-document-close]');
    await until(`!document.querySelector('${dialog}')`);
  };
  const print = async () => {
    await evaluate(`window.__partnerPrint=null; window.print=()=>{window.__partnerPrint={content:document.querySelector('${dialog}').textContent,mode:document.body.classList.contains('partner-print-open')}; window.dispatchEvent(new Event('afterprint'));};`);
    await click(`${dialog} [data-invoice-print]`);
    const captured = await evaluate('window.__partnerPrint');
    assert.ok(captured?.mode, 'The preview enters its document print layout');
    assert.ok(captured.content.includes('همکار گردش قابل ویرایش'), 'Print uses the currently opened partner document');
    assert.equal(await evaluate(`document.body.classList.contains('partner-print-open')`), false, 'Print cleanup restores the workspace');
  };
  const sameIdentity = (after, before) => {
    for (const key of ['id', 'transactionId', 'invoiceNumber', 'createdAt']) assert.equal(after[key], before[key], `Editing preserves ${key}`);
  };

  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com*' }, { urlPattern: '*fonts.gstatic.com*' }] });
  await resize(1440);
  await go('/register'); await ready('#account-password-confirmation');
  await until(`!document.querySelector('.accounting-submit').disabled`);
  await fill('#account-username', 'partner-document-actions');
  await fill('#account-gallery-name', 'گالری آزمون گردش همکار');
  await fill('#account-password', 'partner-actions-test-password');
  await fill('#account-password-confirmation', 'partner-actions-test-password');
  await click('.accounting-submit'); await ready('.workspace-page');

  // A newly saved standalone remittance immediately supports edit and print.
  await open('partner-remittance');
  await click('[data-partner-new]');
  await fill('[data-partner-profile] [name="name"]', 'همکار گردش قابل ویرایش');
  await click('[data-partner-save]');
  await ready('[data-partner-settlement-form]');
  await fields('[data-partner-settlement-form]', { direction: 'debit', goldAmount: '4', reference: 'حواله فوری' });
  await click('[data-partner-payment-save]');
  await preview({ text: 'حواله فوری' });
  const remittance = (await partner()).entries.at(-1);
  await print();
  await click(`${dialog} [data-invoice-edit]`);
  await fields(settlement, { goldAmount: '6', note: 'حواله اصلاح شد' });
  await click(`${settlement} [data-partner-payment-save]`);
  await preview({ text: 'حواله اصلاح شد' });
  sameIdentity(await entry(remittance.id), remittance);
  assert.equal((await partner()).entries.length, 1);
  assert.equal((await partner()).goldBalance, 6);
  await close();

  // Purchase with an immediate payment: edits keep stock and the ledger in sync.
  await open('partner-crafted-purchase');
  await fields('[data-partner-invoice]', { gold18Price: '100000', itemName: 'انگشتر آزمون گردش', itemCount: '2', weight: '8', ayar: '750', wagePercent: '0', profitPercent: '0' });
  await click('.partner-invoice-payment summary');
  await fields('[data-partner-invoice]', { paidGold: '1', refNumber: 'پرداخت خرید فوری' });
  await click('[data-partner-invoice-save]');
  await preview({ text: 'انگشتر آزمون گردش' });
  const purchased = await data();
  const purchase = purchased.partners[0].entries.find(saved => saved.type === 'purchase');
  assert.equal(purchase.paidGold, 1);
  assert.equal(purchased.partners[0].goldBalance, 13);
  await close();
  await statement();
  await click(`${row(purchase.id)} [data-partner-entry-edit]`);
  await fields(invoice, { weight: '10' });
  await click(`${invoice} .partner-invoice-payment summary`);
  await fields(invoice, { paidGold: '2' });
  await click(`${invoice} [data-partner-invoice-save]`);
  await preview();
  const afterPurchase = await data();
  const editedPurchase = await entry(purchase.id);
  sameIdentity(editedPurchase, purchase);
  assert.deepEqual(editedPurchase.documentIds, purchase.documentIds);
  assert.equal(afterPurchase.documents.length, purchased.documents.length);
  assert.equal(afterPurchase.partners[0].entries.length, purchased.partners[0].entries.length);
  assert.equal(afterPurchase.partners[0].goldBalance, 14);
  assert.equal(editedPurchase.paidGold, 2);
  await close();

  // A sale also opens immediately and its receipt can be corrected in place.
  await open('partner-crafted-sale');
  await fields('[data-partner-invoice]', { gold18Price: '100000', inventorySourceId: purchase.documentIds[0], profitPercent: '0' });
  await click('.partner-invoice-payment summary');
  await fields('[data-partner-invoice]', { paidGold: '0.5', refNumber: 'دریافت فروش فوری' });
  await click('[data-partner-invoice-save]');
  await preview({ text: 'دریافت فروش فوری' });
  const sold = await data();
  const sale = sold.partners[0].entries.find(saved => saved.type === 'sale');
  assert.equal(sale.paidGold, 0.5);
  assert.equal(sold.partners[0].goldBalance, 9.5);
  await close();
  await statement();
  await click(`${row(sale.id)} [data-partner-entry-edit]`);
  await ready(invoice);
  assert.equal(await evaluate(`document.querySelector('${invoice} [name="inventorySourceId"]').value`), purchase.documentIds[0]);
  await click(`${invoice} .partner-invoice-payment summary`);
  await fields(invoice, { paidGold: '1' });
  await click(`${invoice} [data-partner-invoice-save]`);
  await preview();
  sameIdentity(await entry(sale.id), sale);
  const afterSale = await data();
  assert.equal(afterSale.documents.length, sold.documents.length);
  assert.equal(afterSale.partners[0].entries.length, sold.partners[0].entries.length);
  assert.equal(afterSale.partners[0].goldBalance, 10);
  assert.equal((await entry(sale.id)).paidGold, 1);
  await close();

  // Standalone cash receipts/payments receive their own edit/print document.
  await statement();
  await click('[data-partner-settlement]');
  await fields('[data-partner-settlement-form]', { paymentMethod: 'cash', direction: 'debit', tomanAmount: '200000', reference: 'دریافت وجه فوری' });
  await click('[data-partner-payment-save]');
  await preview({ text: 'دریافت وجه فوری' });
  await ready('[data-partner-settlement-details]');
  const cash = (await partner()).entries.at(-1);
  assert.ok(cash.transactionId);
  assert.ok(cash.invoiceNumber > 0);
  await close();
  await click(`${row(cash.id)} [data-partner-entry-edit]`);
  assert.equal(await evaluate(`document.querySelector('${settlement} [name="paymentMethod"]').value`), 'cash');
  await fields(settlement, { direction: 'credit', tomanAmount: '300000', note: 'پرداخت وجه اصلاح شد' });
  await click(`${settlement} [data-partner-payment-save]`);
  await preview({ text: 'پرداخت وجه اصلاح شد' });
  sameIdentity(await entry(cash.id), cash);
  assert.equal((await partner()).entries.length, afterSale.partners[0].entries.length + 1);
  assert.equal((await partner()).tomanBalance, -300000);
  await print();
  await close();

  await click('[data-partner-settlement]');
  await fields('[data-partner-settlement-form]', { paymentMethod: 'gold', direction: 'credit', goldAmount: '2', tomanAmount: '', reference: 'پرداخت طلای فوری' });
  await click('[data-partner-payment-save]');
  await preview({ text: 'پرداخت طلای فوری' });
  const gold = (await partner()).entries.at(-1);
  assert.equal(gold.paymentMethod, 'gold');
  assert.equal((await partner()).goldBalance, 8);
  await resize(390, 844);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
  await screenshot('partner-document-actions-mobile', dialog);
  await close(); await resize(1440);

  // Older invoices have separate linked settlement rows. Editing that row must
  // open the parent invoice and preserve both identities without duplicating it.
  const current = await workspace();
  const legacyCreated = await api(`/api/owner/partners/${current.data.partners[0].id}/invoices`, {
    method: 'POST', body: { revision: current.revision, requestId: await evaluate('crypto.randomUUID()'),
      date: '2026-10-08', calculationVersion: 2, direction: 'purchase', gold18Price: 100000,
      paidGold: 1, refNumber: 'پرداخت وابسته قدیمی',
      lines: [{ category: 'crafted', itemName: 'النگوی قدیمی', craftedKind: 'النگو', itemCount: 1, weight: 5, ayar: 750, wagePercent: 0, profitPercent: 0 }] },
  });
  assert.equal(legacyCreated.status, 201, JSON.stringify(legacyCreated.body));
  const legacy = legacyCreated.body.data.partners[0].entries.find(saved => saved.calculationVersion === 2 && saved.type === 'purchase');
  const linkedPayment = legacyCreated.body.data.partners[0].entries.find(saved => saved.linkedEntryId === legacy.id);
  assert.ok(linkedPayment);
  await go('/account'); await ready('.workspace-page'); await statement();
  await click(`${row(linkedPayment.id)} [data-partner-entry-edit]`);
  await ready(invoice);
  assert.equal(await evaluate(`document.querySelector('${invoice} [name="itemName"]').value`), 'النگوی قدیمی');
  assert.equal(await evaluate(`document.querySelector('${invoice} [name="paidGold"]').value`), '1');
  await click(`${invoice} .partner-invoice-payment summary`);
  await fields(invoice, { paidGold: '2' });
  await click(`${invoice} [data-partner-invoice-save]`);
  await preview({ text: 'النگوی قدیمی' });
  sameIdentity(await entry(legacy.id), legacy);
  sameIdentity(await entry(linkedPayment.id), linkedPayment);
  assert.equal((await entry(linkedPayment.id)).goldCredit, 2);
  assert.equal((await partner()).goldBalance, 11);
  assert.equal((await partner()).entries.length, legacyCreated.body.data.partners[0].entries.length);
  await close();

  const saved = await data();
  await go('/account'); await ready('.workspace-page'); await statement();
  assert.deepEqual((await data()).partners, saved.partners, 'All edits survive a full reload');
  assert.equal(await evaluate(`document.querySelectorAll('[data-partner-entry-edit]').length`), saved.partners[0].entries.length, 'Every ledger row can be edited');

  // Staff with only partner read access can inspect and print but cannot edit.
  const created = await api('/api/owner/users', { method: 'POST', body: { username: 'partner-actions-reader', password: 'partner-reader-password', permissions: ['partners.read'] } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await api('/api/auth/logout', { method: 'POST' });
  const loggedIn = await api('/api/auth/login', { method: 'POST', body: { username: 'partner-actions-reader', password: 'partner-reader-password' } });
  assert.equal(loggedIn.status, 200, JSON.stringify(loggedIn.body));
  await go('/account'); await ready('.workspace-page'); await statement();
  assert.equal(await evaluate(`document.querySelectorAll('[data-partner-entry-edit]').length`), 0);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-partner-settlement]'))`), false);
  await click(`${row(linkedPayment.id)} [data-partner-entry-view]`);
  await preview({ editable: false, text: 'النگوی قدیمی' });
  await print(); await close();
  await click(`${row(cash.id)} [data-partner-entry-view]`);
  await preview({ editable: false, text: 'پرداخت وجه اصلاح شد' });
  await print(); await close();
  console.log('Partner document actions passed: immediate invoice/remittance/cash/gold preview and print, statement edits, linked-payment routing, preserved identities and balances, reload, mobile, and read-only access.');
}
