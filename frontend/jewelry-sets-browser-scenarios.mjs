import assert from 'node:assert/strict';
import { normalizeDigits } from './src/persianDate.js';

const numericInput = value => Number(normalizeDigits(value).replace(/[٬,\s]/g, '').replace(/٫/g, '.'));

// Scenarios share the existing native-CDP harness, but use their own account.
export async function runJewelrySetChecks({ cdp, evaluate, ready, click, fill, navigate, screenshot, noOverflow, pause }) {
  const account = 'sets-browser-test';
  const documentsKey = `zarngarDocuments:${account}`;
  const customersKey = `zarngarCustomers:${account}`;
  const readStorage = key => evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}) || '[]')`);
  const stored = () => readStorage(documentsKey);
  const customers = () => readStorage(customersKey);
  const valueOf = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
  const exists = selector => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  const field = name => `.document-form [name="${name}"]`;
  const partSelector = id => `[data-set-part="${id}"]`;
  const partField = (id, name) => `${partSelector(id)} [data-part-field="${name}"]`;
  const partIds = () => evaluate(`Array.from(document.querySelectorAll('[data-set-part]'), part => part.dataset.setPart)`);
  const enter = async values => { for (const [name, value] of Object.entries(values)) await fill(field(name), String(value)); };
  const enterPart = async (id, values) => { for (const [name, value] of Object.entries(values)) await fill(partField(id, name), String(value)); };
  const submit = async () => { await click('.document-form button[type="submit"]'); await pause(100); };
  const successfulSubmit = async () => { await submit(); await ready('.document-form .form-message.success'); };
  const begin = async (kind, name, mode = 'separate') => {
    await navigate('register');
    await fill(field('type'), 'crafted-purchase');
    await enter({ customerId: '', customerName: 'فروشنده مجموعه', craftedKind: kind, itemName: name });
    await fill(field('setMode'), mode);
  };
  const assertClose = (actual, expected, description) => assert.ok(Math.abs(actual - expected) < 0.000001, `${description}: expected ${expected}, received ${actual}`);
  const balance = (records, source) => numericInput(source.itemCount) - records.filter(record => record.inventorySourceId === source.id).reduce((sum, record) => sum + numericInput(record.itemCount), 0);
  const sameGroup = (rows, count, kind, name) => {
    assert.equal(rows.length, count, `${name} has one persisted row per piece`);
    assert.equal(new Set(rows.map(row => row.id)).size, count, `${name} pieces have independent IDs`);
    assert.equal(new Set(rows.map(row => row.productCode)).size, count, `${name} pieces have independent product codes`);
    assert.ok(rows.every(row => row.productCode && row.setId && row.transactionId), `${name} has complete membership and invoice metadata`);
    assert.equal(new Set(rows.map(row => row.setId)).size, 1, `${name} pieces share a set ID`);
    assert.equal(new Set(rows.map(row => row.transactionId)).size, 1, `${name} pieces share an invoice ID`);
    assert.ok(rows.every(row => row.setKind === kind && row.setMode === 'separate' && row.setPieceCount === count && row.setName === name), `${name} retains its set type, name and size`);
    assert.ok(rows.every(row => !row.setParts && row.craftedKind !== kind), `${name} does not create a second parent stock row`);
  };

  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(() => {
    const account = ${JSON.stringify(account)};
    localStorage.setItem('zarngarCurrentUser', account);
    for (const key of ['zarngarDocuments', 'zarngarCustomers', 'zarngarGoldPurchases', 'zarngarCheques']) localStorage.setItem(key + ':' + account, '[]');
    localStorage.setItem('zarngarPrices:' + account, JSON.stringify({goldGramPrice:'100'}));
    localStorage.setItem('zarngarOpeningSetup:' + account, JSON.stringify({completed:true}));
  })()`);
  await cdp('Page.reload'); await pause(250); await ready('.workspace-rail');

  // A half-set can contain arbitrary kinds and any number of separately valued pieces.
  await begin('نیم‌ست', 'نیم‌ست انتخابی سه‌قطعه');
  let ids = await partIds();
  assert.equal(ids.length, 2, 'separate mode starts with two user-defined pieces');
  assert.ok((await evaluate(`Array.from(document.querySelectorAll('[data-part-field="craftedKind"]'), input => input.value)`)).every(value => value === ''), 'new rows do not impose necklace or earring types');
  await enterPart(ids[0], { craftedKind: 'گوشواره', weight: '۲', wagePercent: '۱۰', wageFixed: '۵', otherCosts: '۳' });
  await enterPart(ids[1], { craftedKind: 'پابند', weight: '۳', wagePercent: '۲۰', wageFixed: '۷', otherCosts: '۴' });
  await click('[data-add-set-part]'); await click('[data-add-set-part]');
  ids = await partIds();
  assert.equal(ids.length, 4, 'half-set editor allows at least four arbitrary pieces');
  await click(`[data-remove-set-part="${ids[3]}"]`);
  ids = await partIds();
  assert.equal(ids.length, 3, 'an extra piece can be removed');
  const draftIds = [...ids];
  await fill(field('setMode'), 'together');
  assert.equal(await exists('[data-set-part]'), false, 'together mode shows one stock item');
  await enter({ weight: '99', wagePercent: '0' });
  await fill(field('setMode'), 'separate');
  assert.deepEqual(await partIds(), draftIds, 'switching modes retains existing separate-piece drafts');
  assert.equal(await valueOf(partField(ids[0], 'weight')), '۲', 'piece weight survives a mode toggle');
  await fill(field('setMode'), 'together');
  assert.equal(await valueOf(field('weight')), '99', 'single-item fields survive a mode toggle');
  await fill(field('setMode'), 'separate');
  await enter({ gramDebt: '۰٫۵', rialDebt: '۷۷' });

  await submit(); await ready('.document-form .form-message.error');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(partField(ids[2], 'craftedKind'))}).getAttribute('aria-invalid')`), 'true', 'missing component kind is identified on its own row');
  assert.deepEqual(await stored(), [], 'an incomplete piece prevents saving the entire set');
  assert.deepEqual(await customers(), [], 'an invalid set does not create a customer');
  await enterPart(ids[2], { craftedKind: 'دستبند', itemCount: '۲', weight: 'نامعتبر', wagePercent: '۵', wageFixed: '۹', otherCosts: '۶' });
  await submit(); await ready('.document-form .form-message.error');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(partField(ids[2], 'weight'))}).getAttribute('aria-invalid')`), 'true', 'malformed component weight has a visible field error');
  assert.deepEqual(await stored(), [], 'malformed component weight never saves a partial set');
  await enterPart(ids[2], { weight: '۴' });
  await enterPart(ids[0], { gramPrice: '' });
  assert.ok(await evaluate(`document.querySelector(${JSON.stringify(`${partSelector(ids[0])} .jewelry-set-part-total strong`)}).textContent.includes('۲۲۸')`), 'blank component price previews the saved gold rate');
  assert.ok(await evaluate(`document.querySelector('.jewelry-set-footer strong').textContent.includes('۱٬۴۶۹')`), 'component preview includes the fallback-priced piece');
  assert.ok(await evaluate(`document.querySelector('.document-form > .document-preview strong').textContent.includes('۱٬۴۶۹')`), 'invoice preview agrees with the component total');
  await noOverflow('desktop separate half-set editor'); await screenshot('jewelry-set-editor-desktop');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await pause(200);
  await noOverflow('mobile separate half-set editor'); await screenshot('jewelry-set-editor-mobile');
  await successfulSubmit();
  const halfSet = await stored();
  sameGroup(halfSet, 3, 'نیم‌ست', 'نیم‌ست انتخابی سه‌قطعه');
  const earring = halfSet.find(row => row.craftedKind === 'گوشواره');
  const anklet = halfSet.find(row => row.craftedKind === 'پابند');
  const bracelet = halfSet.find(row => row.craftedKind === 'دستبند');
  assertClose(earring.amount, 228, 'earring uses its own weight and wages');
  assertClose(anklet.amount, 371, 'anklet uses its own weight and wages');
  assertClose(bracelet.amount, 870, 'bracelet quantity multiplies only its own weight and wages');
  assertClose(halfSet.reduce((sum, row) => sum + row.amount, 0), 1469, 'set amount has no extra parent charge');
  assert.equal(halfSet.reduce((sum, row) => sum + row.gramDebt, 0), 0.5, 'purchase gram debt is recorded once');
  assert.equal(halfSet.reduce((sum, row) => sum + row.rialDebt, 0), 77, 'purchase money debt is recorded once');
  assert.ok(halfSet.every(row => row.gold18Price === 100 && row.recordedAt), 'each purchased piece retains the gold price and save time');
  const initialCustomers = await customers();
  assert.equal(initialCustomers.length, 1, 'one set creates one customer');
  assert.equal(new Set(halfSet.map(row => row.customerId)).size, 1, 'all pieces belong to the same customer');
  assert.equal(initialCustomers[0].gramDebt, -0.5, 'customer gram debt is not multiplied by piece count');
  assert.equal(initialCustomers[0].rialDebt, -77, 'customer money debt is not multiplied by piece count');

  // Together half-sets and full sets each create just one inventory item.
  const togetherRecords = [];
  for (const [kind, name, weight] of [['نیم‌ست', 'نیم‌ست یکپارچه', '9'], ['ست', 'ست یکپارچه', '12']]) {
    const before = await stored();
    await begin(kind, name, 'together');
    assert.equal(await exists('[data-add-set-part]'), false, `${kind} together has no separate-piece editor`);
    await enter({ itemCount: '1', weight, ayar: '750', gramPrice: '100', wagePercent: '0' });
    await successfulSubmit();
    const next = await stored();
    assert.equal(next.length, before.length + 1, `${kind} together produces exactly one record`);
    assert.equal(next[0].craftedKind, kind);
    assert.equal(next[0].setMode, 'together');
    assert.equal(next[0].amount, numericInput(weight) * 100);
    togetherRecords.push(next[0]);
  }

  await begin('ست', 'ست چهارقطعه دلخواه');
  await click('[data-add-set-part]'); await click('[data-add-set-part]');
  ids = await partIds();
  assert.equal(ids.length, 4, 'full sets can contain four independent pieces');
  for (const [index, kind] of ['گردنبند', 'زنجیر', 'انگشتر', 'سایر'].entries()) {
    await enterPart(ids[index], { craftedKind: kind, itemName: kind === 'سایر' ? 'سنجاق طلایی' : '', weight: String(index + 1) });
  }
  await successfulSubmit();
  const fullSet = (await stored()).filter(row => row.setName === 'ست چهارقطعه دلخواه');
  sameGroup(fullSet, 4, 'ست', 'ست چهارقطعه دلخواه');
  assert.equal(fullSet.find(row => row.craftedKind === 'سایر').itemName, 'سنجاق طلایی', 'custom component names persist');
  assert.equal(fullSet.reduce((sum, row) => sum + row.amount, 0), 1000, 'full set sums its four individual values');
  const unrelated = [...togetherRecords, ...fullSet];

  await cdp('Page.reload'); await pause(250); await ready('.workspace-rail'); await navigate('vault');
  await ready(`[data-set-id="${earring.setId}"]`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-set-id="${earring.setId}"] .vault-item').length`), 3, 'reload restores three half-set component cards in one group');
  assert.equal(await evaluate(`document.querySelectorAll('[data-set-id="${fullSet[0].setId}"] .vault-item').length`), 4, 'reload preserves the independent full-set group');
  await noOverflow('mobile grouped inventory'); await screenshot('jewelry-set-vault-mobile');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false }); await pause(200);
  await noOverflow('desktop grouped inventory'); await screenshot('jewelry-set-vault-desktop');

  // Sell just one component from its own stock card.
  const earringCard = `[data-product-code="${earring.productCode}"]`;
  await click(`${earringCard} > .vault-item-summary`);
  await click(`${earringCard} .button-primary`); await ready('.stock-picker-picked');
  assert.equal(await exists('[data-set-part]'), false, 'individual component sale uses its own stock form');
  assert.equal(await valueOf(field('weight')), earring.weight, 'individual component sale keeps its own weight');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(field('weight'))}).readOnly`), true, 'sold piece identity is locked');
  await enter({ customerId: '', customerName: 'خریدار مجموعه', itemCount: '1', gramPrice: '150', gold18Price: '175', wagePercent: '10', wageFixed: '5', otherCosts: '3', profitPercent: '0', discountRial: '8' });
  await successfulSubmit();
  const afterSingle = await stored();
  const singleSale = afterSingle[0];
  assert.equal(singleSale.inventorySourceId, earring.id);
  assert.equal(singleSale.setId, earring.setId, 'single sale retains set membership');
  assert.equal(singleSale.amount, 330, 'single component sale uses its entered price and discount');
  assert.equal(singleSale.gold18Price, 175, 'single component sale saves its own gold snapshot');
  assert.equal(balance(afterSingle, earring), 0);
  assert.equal(balance(afterSingle, anklet), 1, 'selling earring leaves anklet available');
  assert.equal(balance(afterSingle, bracelet), 2, 'selling earring leaves both bracelets available');

  await navigate('vault');
  assert.equal(await exists(earringCard), false, 'depleted component leaves the active stock list');
  assert.ok(await evaluate(`document.querySelector('[data-set-id="${earring.setId}"] .vault-set-heading p').textContent.includes('بخشی از مجموعه فروخته شده')`), 'partially sold set explains its remaining pieces');
  await click(`[data-sell-set="${earring.setId}"]`); await ready('.jewelry-set-select-part');
  ids = await partIds();
  assert.deepEqual(new Set(ids), new Set([anklet.id, bracelet.id]), 'group sale includes only remaining source pieces');
  assert.equal(await exists('[data-add-set-part]'), false, 'sale cannot add unowned pieces');
  assert.equal(await exists('[data-remove-set-part]'), false, 'sale retains source identities');
  await enter({ customerId: '', customerName: 'خریدار مجموعه', gold18Price: '205', gramDebt: '2', rialDebt: '300' });
  await click(partField(bracelet.id, 'selected'));
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(partField(bracelet.id, 'selected'))}).checked`), false, 'group sale allows selecting only one remaining component');
  await enterPart(anklet.id, { itemCount: '2' });
  const beforeRejectedDocuments = await stored();
  const beforeRejectedCustomers = await customers();
  await submit(); await ready('.jewelry-set-group-error');
  assert.deepEqual(await stored(), beforeRejectedDocuments, 'overselling one selected component saves no records');
  assert.deepEqual(await customers(), beforeRejectedCustomers, 'rejected batch leaves customer balances unchanged');
  await enterPart(anklet.id, { itemCount: '1' });
  await click('.jewelry-set-actions button:nth-child(2)');
  await submit(); await ready('.jewelry-set-group-error');
  assert.deepEqual(await stored(), beforeRejectedDocuments, 'empty component selection cannot create a sale');
  await click('.jewelry-set-actions button:nth-child(1)');
  assert.ok((await evaluate(`Array.from(document.querySelectorAll('[data-part-field="selected"]'), input => input.checked)`)).every(Boolean), 'select-all restores every remaining piece');
  await enterPart(anklet.id, { itemCount: '1', gramPrice: '120', wagePercent: '0', wageFixed: '0', otherCosts: '0', profitPercent: '0', discountRial: '0' });
  await enterPart(bracelet.id, { itemCount: '2', gramPrice: '200', wagePercent: '5', wageFixed: '9', otherCosts: '6', profitPercent: '0', discountRial: '10' });
  await noOverflow('desktop multi-piece sale'); await screenshot('jewelry-set-sale-desktop');
  await successfulSubmit();
  const afterBatch = await stored();
  const batch = afterBatch.filter(row => !beforeRejectedDocuments.some(before => before.id === row.id));
  assert.equal(batch.length, 2, 'selling the remainder creates two source-linked sale rows');
  assert.equal(new Set(batch.map(row => row.transactionId)).size, 1, 'a grouped sale has one invoice ID');
  assert.notEqual(batch[0].transactionId, singleSale.transactionId, 'separate sale actions have separate invoice IDs');
  assert.ok(batch.every(row => row.gold18Price === 205 && row.setId === earring.setId), 'batch rows share the current trade snapshot and set identity');
  assert.equal(batch.find(row => row.inventorySourceId === anklet.id).amount, 360);
  assert.equal(batch.find(row => row.inventorySourceId === bracelet.id).amount, 1700);
  assert.equal(batch.reduce((sum, row) => sum + row.gramDebt, 0), 2, 'batch gram debt is recorded once');
  assert.equal(batch.reduce((sum, row) => sum + row.rialDebt, 0), 300, 'batch money debt is recorded once');
  assert.ok(halfSet.every(source => balance(afterBatch, source) === 0), 'batch depletes only the selected remaining quantities');
  for (const source of unrelated) {
    assert.deepEqual(afterBatch.find(row => row.id === source.id), source, 'selling one set preserves every unrelated inventory record');
    assert.equal(balance(afterBatch, source), numericInput(source.itemCount), 'selling one set leaves other set quantities intact');
  }
  assert.deepEqual(afterBatch.filter(row => halfSet.some(source => source.id === row.id)), halfSet, 'sales preserve purchase amounts, weights, fees and captured rates');
  const buyer = (await customers()).filter(customer => customer.name === 'خریدار مجموعه');
  assert.equal(buyer.length, 1, 'single and grouped sales reuse one customer');
  assert.equal(buyer[0].gramDebt, 2); assert.equal(buyer[0].rialDebt, 300);
  await navigate('vault');
  assert.equal(await exists(`[data-set-id="${earring.setId}"]`), false, 'fully sold set leaves active grouped inventory');
  assert.equal(await evaluate(`document.querySelectorAll('[data-set-id="${fullSet[0].setId}"] .vault-item').length`), 4, 'unrelated full set remains available');

  // Repricing affects current assets while all original trade documents stay fixed.
  await navigate('pricing'); await fill('.price-form [name="goldGramPrice"]', '999');
  await click('.price-form button[type="submit"]'); await ready('.price-form .form-message.success');
  await cdp('Page.reload'); await pause(250); await ready('.workspace-rail'); await navigate('vault');
  assert.deepEqual(await stored(), afterBatch, 'market-price changes and reload leave all saved set trades immutable');
  await navigate('search'); await fill('.search-controls input', 'نیم‌ست انتخابی سه‌قطعه');
  assert.equal(await evaluate(`document.querySelectorAll('.document-card').length`), 6, 'set-name search finds its three entries and three sales');

  // Opening inventory uses the same flexible component editor, without trade prices.
  await navigate('opening'); await ready('.opening-shell');
  await fill('.opening-rate-panel [name="goldGramPrice"]', '');
  const openingRow = '[data-opening-category="crafted"]';
  await fill(`${openingRow} [data-opening-field="description"]`, 'نیم‌ست اولیه دلخواه');
  await fill(`${openingRow} [data-opening-field="craftedKind"]`, 'نیم‌ست');
  await fill(`${openingRow} [name="setMode"]`, 'separate');
  await click(`${openingRow} [data-add-set-part]`);
  ids = await partIds();
  assert.equal(ids.length, 3, 'opening inventory accepts more than two separate pieces');
  for (const [index, kind] of ['انگشتر', 'گردنبند', 'پابند'].entries()) await enterPart(ids[index], { craftedKind: kind, weight: String(index + 1) });
  await fill('.opening-rate-panel [name="goldGramPrice"]', '100');
  assert.ok(await evaluate(`document.querySelector('.jewelry-set-footer strong').textContent.includes('۶۰۰')`), 'entering the opening gold rate after blank-rate pieces refreshes their preview');
  await click('.opening-shell button[type="submit"]'); await ready('.opening-shell .form-message.success');
  const openings = (await stored()).filter(row => row.source === 'opening-inventory');
  sameGroup(openings, 3, 'نیم‌ست', 'نیم‌ست اولیه دلخواه');
  assert.ok(openings.every(row => row.gold18Price === undefined), 'opening set pieces have no trade-price snapshot');
  assert.equal(openings.reduce((sum, row) => sum + row.amount, 0), 600, 'opening total sums only the individual pieces');
  assert.deepEqual((await stored()).filter(row => row.source !== 'opening-inventory'), afterBatch, 'adding opening sets preserves previous trades');
  await navigate('vault'); await ready(`[data-set-id="${openings[0].setId}"]`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await pause(200);
  await noOverflow('mobile opening and purchased set groups'); await screenshot('jewelry-set-opening-vault-mobile');
  console.log('Jewelry-set browser checks passed: flexible half/full sets; together single records; arbitrary component kinds and custom names; add/remove and draft mode toggles; atomic validation and oversell rejection; independent codes/weights/wages; shared membership and invoice IDs; debt/customer consistency; individual and grouped sales; subset/all/none selection; opening inventory; immutable trade snapshots; reload/search and desktop/mobile layouts.');
}
