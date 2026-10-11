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
    assert.equal(await evaluate(`Boolean(document.querySelector('${dialog} [data-invoice-delete]'))`), editable);
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
  assert.equal(await evaluate(`document.querySelector('${dialog} [data-partner-item-description]').textContent`), 'انگشتر آزمون گردش');
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

  // Persisted v4 documents must open, edit and print from both entry points.
  const v4Workspace = await workspace();
  const v4Created = await api(`/api/owner/partners/${v4Workspace.data.partners[0].id}/invoices`, {
    method: 'POST', body: { revision: v4Workspace.revision, requestId: await evaluate('crypto.randomUUID()'),
      date: '2026-10-09', calculationVersion: 4, settlementUnit: 'mixed', gold18Price: 100000,
      paidGold: 0.1, paidToman: 10,
      lines: [{ category: 'crafted', itemName: 'سند قدیمی دو حسابی', craftedKind: 'النگو', itemCount: 2, weight: 2, ayar: 750,
        wagePercent: 10, wageFixed: 100, otherCosts: 50, profitPercent: 5, profitFixed: 1000, settlementUnit: 'gold' },
      { category: 'remittance', remittanceDirection: 'credit', settlementUnit: 'toman', tomanAmount: 200 }] },
  });
  assert.equal(v4Created.status, 201, JSON.stringify(v4Created.body));
  const v4 = v4Created.body.data.partners[0].entries.at(-1);
  await go('/account'); await ready('.workspace-page'); await statement();
  await click(`${row(v4.id)} [data-partner-entry-edit]`); await ready(invoice);
  await fields(`${invoice} [data-partner-line="0"]`, { weight: '3' });
  await click(`${invoice} [data-partner-invoice-save]`); await preview();
  sameIdentity(await entry(v4.id), v4);
  assert.equal((await entry(v4.id)).goldDebit, 3.465);
  assert.equal((await entry(v4.id)).tomanDebit, 2315);
  assert.equal((await entry(v4.id)).tomanCredit, 210);
  await evaluate("document.body.classList.add('partner-print-open')");
  await cdp('Emulation.setEmulatedMedia', { media: 'print' });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#root')).display`), 'none');
  assert.equal(await evaluate(`document.querySelector('${dialog} table').getBoundingClientRect().height > 0`), true);
  assert.equal(await evaluate(`document.querySelector('${dialog} [data-partner-item-description]').textContent`), 'سند قدیمی دو حسابی');
  const printed = await cdp('Page.printToPDF', { preferCSSPageSize: true, printBackground: false });
  assert.ok(Buffer.from(printed.data, 'base64').length > 1000, 'The partner document produces a nonempty PDF');
  await cdp('Emulation.setEmulatedMedia', { media: 'screen' });
  await evaluate("document.body.classList.remove('partner-print-open')");
  await print(); await close();
  await click('[data-section="reports"]');
  await click('[data-tool="search"]');
  const card = `[data-invoice-id="${v4.transactionId}"]`;
  await click(`${card} [data-invoice-view]`); await preview(); await print(); await close();
  await click(`${card} [data-invoice-edit]`); await ready(invoice);
  await fields(`${invoice} [data-partner-line="1"]`, { tomanAmount: '300' });
  await click(`${invoice} [data-partner-invoice-save]`); await preview();
  assert.equal((await entry(v4.id)).goldDebit, 3.465);
  assert.equal((await entry(v4.id)).tomanCredit, 310);
  sameIdentity(await entry(v4.id), v4);
  await print(); await close();
  for (const document of [legacy, cash, gold]) {
    await click(`[data-invoice-id="${document.transactionId}"] [data-invoice-view]`);
    await preview(); await print(); await close();
    await click(`[data-invoice-id="${document.transactionId}"] [data-invoice-edit]`);
    await ready(document.type === 'settlement' ? settlement : invoice);
    await close();
  }

  const saved = await data();
  await go('/account'); await ready('.workspace-page'); await statement();
  assert.deepEqual((await data()).partners, saved.partners, 'All edits survive a full reload');
  assert.equal(await evaluate(`document.querySelectorAll('[data-partner-entry-edit]').length`), saved.partners[0].entries.length, 'Every ledger row can be edited');

  // Cancel is inert; a sold purchase cannot be removed while its sale remains.
  const beforeDelete = await workspace();
  await click(`${row(purchase.id)} [data-partner-entry-delete]`);
  await ready('[data-partner-delete-confirm]');
  await click('[data-cancel-partner-delete]'); await preview();
  assert.deepEqual(await workspace(), beforeDelete);
  await click(`${dialog} [data-invoice-delete]`);
  await click('[data-confirm-partner-delete]');
  await ready('[data-partner-delete-confirm] [role="alert"]');
  assert.ok((await evaluate(`document.querySelector('[data-partner-delete-confirm] [role="alert"]').textContent`)).includes('سابقه'));
  assert.deepEqual(await workspace(), beforeDelete);
  await close();

  // Delete from search, then lose the successful response: retry the same request.
  await click('[data-section="reports"]'); await click('[data-tool="search"]');
  await click(`[data-invoice-id="${sale.transactionId}"] [data-invoice-delete]`);
  await ready('[data-partner-delete-confirm]');
  await evaluate(`window.__deleteRequests=[]; window.__originalFetch=window.fetch; window.fetch=async (...args)=>{
    const deleting=args[1]?.method==='DELETE';
    if(deleting) window.__deleteRequests.push(JSON.parse(args[1].body));
    const response=await window.__originalFetch(...args);
    if(deleting && window.__deleteRequests.length===1 && response.ok) throw new TypeError('Lost delete response');
    return response;
  };`);
  await click('[data-confirm-partner-delete]'); await ready('[data-partner-delete-confirm] [role="alert"]');
  assert.equal(await entry(sale.id), undefined, 'The server committed before its acknowledgment was lost');
  await click('[data-confirm-partner-delete]'); await until(`!document.querySelector('${dialog}')`);
  const attempts = await evaluate('window.__deleteRequests');
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1]);
  await evaluate('window.fetch=window.__originalFetch');
  const afterSaleDelete = await workspace();
  assert.equal(afterSaleDelete.revision, beforeDelete.revision + 1, 'Retry does not reverse balances twice');
  assert.equal((await partner()).goldBalance, Number((saved.partners[0].goldBalance + 4).toFixed(6)));
  assert.deepEqual(afterSaleDelete.data.documents, beforeDelete.data.documents.filter(document => !sale.documentIds.includes(document.id)));
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-invoice-id="${sale.transactionId}"]'))`), false);
  await click(`[data-invoice-id="${purchase.transactionId}"] [data-invoice-delete]`);
  await click('[data-confirm-partner-delete]'); await until(`!document.querySelector('${dialog}')`);
  assert.equal(await entry(purchase.id), undefined);
  assert.equal((await partner()).goldBalance, Number((saved.partners[0].goldBalance - 4).toFixed(6)));

  // Opening a confirmation never grants permission to delete a later revision.
  await click(`${card} [data-invoice-delete]`); await ready('[data-partner-delete-confirm]');
  const atConfirmation = await workspace();
  const changed = await api(`/api/owner/partners/${atConfirmation.data.partners[0].id}`, { method: 'PATCH', body: {
    revision: atConfirmation.revision, requestId: await evaluate('crypto.randomUUID()'), note: 'Concurrent profile change' } });
  assert.equal(changed.status, 200);
  await click('[data-confirm-partner-delete]'); await ready('[data-partner-delete-confirm] [role="alert"]');
  assert.ok(await entry(v4.id));
  assert.equal((await workspace()).revision, changed.body.revision);
  await close(); await go('/account'); await ready('.workspace-page'); await statement();
  await click(`${row(v4.id)} [data-partner-entry-delete]`);
  await click('[data-confirm-partner-delete]'); await until(`!document.querySelector('${dialog}')`);
  assert.equal(await entry(v4.id), undefined);

  // Standalone payment deletion also works from the preview on mobile.
  await click(`${row(gold.id)} [data-partner-entry-view]`); await preview();
  await click(`${dialog} [data-invoice-delete]`); await resize(390, 844);
  await screenshot('partner-delete-confirm-mobile', dialog);
  const beforeGoldDelete = await partner();
  await click('[data-confirm-partner-delete]'); await until(`!document.querySelector('${dialog}')`);
  assert.equal(await entry(gold.id), undefined);
  assert.equal((await partner()).goldBalance, beforeGoldDelete.goldBalance + 2);
  await resize(1440);

  // Deleting an old linked payment selects and removes its whole parent invoice.
  const linkedWorkspace = await workspace();
  const disposable = await api(`/api/owner/partners/${linkedWorkspace.data.partners[0].id}/invoices`, { method: 'POST', body: {
    revision: linkedWorkspace.revision, requestId: await evaluate('crypto.randomUUID()'), date: '2026-10-09',
    gold18Price: 100000, calculationVersion: 2, paidGold: 1,
    lines: [{ category: 'crafted', itemName: 'خرید قابل حذف', weight: 2, ayar: 750, itemCount: 1, wagePercent: 0, profitPercent: 0 }] } });
  assert.equal(disposable.status, 201);
  const temporaryEntries = disposable.body.data.partners[0].entries.slice(-2);
  await go('/account'); await ready('.workspace-page'); await statement();
  await click(`${row(temporaryEntries[1].id)} [data-partner-entry-delete]`);
  await click('[data-confirm-partner-delete]'); await until(`!document.querySelector('${dialog}')`);
  assert.deepEqual((await data()).documents, linkedWorkspace.data.documents);
  assert.deepEqual((await partner()).entries, linkedWorkspace.data.partners[0].entries);
  const afterDeletes = await workspace();
  await go('/account'); await ready('.workspace-page'); await statement();
  assert.deepEqual(await workspace(), afterDeletes, 'Deleted documents stay deleted after reload');

  // Match the reported coin layout: only its name belongs in the description cell.
  await click('[data-section="entries"]'); await click('[data-tool="register"]');
  await fill('[data-document-type]', 'coin-purchase');
  await fields('.document-form', { customerName: 'مشتری شرح کوتاه', itemName: 'سکه گل رز ۴۰۰', coinGroup: 'ordinary', coinType: 'گل رز',
    coinWeight: '0.3', coinAyar: '999.9', coinCount: '1', gold18Price: '26350000', gramPrice: '26350000', profitPercent: '0', profitFixed: '1000000' });
  await click('.document-form button[type="submit"]'); await ready('.document-form .form-message.success');
  const coin = (await data()).documents.find(document => document.customerName === 'مشتری شرح کوتاه');
  assert.ok(coin);
  await click('[data-section="reports"]'); await click('[data-tool="search"]');
  await click(`[data-invoice-id="${coin.transactionId}"] [data-invoice-view]`); await ready('.invoice-sheet');
  assert.equal(await evaluate(`document.querySelector('.invoice-item-description').textContent`), 'سکه گل رز ۴۰۰');
  assert.equal(await evaluate(`document.querySelector('[data-invoice-weight]').textContent`), '۰٫۳');
  await screenshot('invoice-customer-name-only', '.invoice-sheet');
  await cdp('Emulation.setEmulatedMedia', { media: 'print' });
  assert.equal(await evaluate(`document.querySelector('.invoice-item-description').textContent`), 'سکه گل رز ۴۰۰');
  await cdp('Emulation.setEmulatedMedia', { media: 'screen' });
  await click('[data-invoice-close]');
  const coinWorkspace = await workspace();
  const partnerCoin = await api(`/api/owner/partners/${coinWorkspace.data.partners[0].id}/invoices`, { method: 'POST', body: {
    revision: coinWorkspace.revision, requestId: await evaluate('crypto.randomUUID()'), date: '2026-10-11', calculationVersion: 3,
    gold18Price: 26350000, lines: [{ category: 'coin', itemName: 'سکه گل رز همکار', coinPricingVersion: 2, coinGroup: 'ordinary', coinType: 'گل رز',
      coinWeight: .3, coinAyar: 999.9, coinCount: 1, profitPercent: 0, profitFixed: 1000000 }] } });
  assert.equal(partnerCoin.status, 201, JSON.stringify(partnerCoin.body));
  const coinEntry = partnerCoin.body.data.partners[0].entries.at(-1);
  await go('/account'); await ready('.workspace-page'); await statement();
  await click(`${row(coinEntry.id)} [data-partner-entry-view]`); await preview();
  assert.equal(await evaluate(`document.querySelector('${dialog} [data-partner-item-description]').textContent`), 'سکه گل رز همکار');
  await screenshot('invoice-partner-name-only', dialog);
  await close();

  // Staff with only partner read access can inspect and print but cannot edit.
  const created = await api('/api/owner/users', { method: 'POST', body: { username: 'partner-actions-reader', password: 'partner-reader-password', permissions: ['partners.read'] } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await api('/api/auth/logout', { method: 'POST' });
  const loggedIn = await api('/api/auth/login', { method: 'POST', body: { username: 'partner-actions-reader', password: 'partner-reader-password' } });
  assert.equal(loggedIn.status, 200, JSON.stringify(loggedIn.body));
  await go('/account'); await ready('.workspace-page'); await statement();
  assert.equal(await evaluate(`document.querySelectorAll('[data-partner-entry-edit]').length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll('[data-partner-entry-delete]').length`), 0);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-partner-settlement]'))`), false);
  await click(`${row(linkedPayment.id)} [data-partner-entry-view]`);
  await preview({ editable: false, text: 'النگوی قدیمی' });
  await print(); await close();
  await click(`${row(cash.id)} [data-partner-entry-view]`);
  await preview({ editable: false, text: 'پرداخت وجه اصلاح شد' });
  await print(); await close();
  console.log('Partner actions passed: edit/delete from search, statement and preview; cancellation, sold stock guard, lost response replay, stale revision, linked payments, balances, names-only descriptions, print, reload, mobile and read-only access.');
}
