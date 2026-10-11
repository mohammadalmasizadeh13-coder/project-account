import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { navigateWorkspace } from './browser-navigation.mjs';
import { inventoryReport } from './src/inventory.js';

export async function checkPartnerTrading({ cdp, evaluate, ready, until, go, fill, click, resize, screenshot, workspace }) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const tool = async name => {
    if (name.startsWith('partner-')) {
      if (await evaluate(`document.querySelector('.workspace-rail')?.getAttribute('aria-hidden') === 'true'`)) { await click('.workspace-menu-toggle'); await pause(260); }
      await click('[data-section="entries"]'); await click(`[data-tool="${name}"]`); return;
    }
    if (name !== 'partners') return navigateWorkspace(name, { click, evaluate, pause });
    if (await evaluate(`document.querySelector('.workspace-rail')?.getAttribute('aria-hidden') === 'true'`)) { await click('.workspace-menu-toggle'); await pause(260); }
    await click('[data-section="crm"]'); await click('[data-crm-group="partners"]');
  };
  const fields = async (scope, values) => { for (const [name, value] of Object.entries(values)) await fill(`${scope} [name="${name}"]`, String(value)); };
  const data = async () => (await workspace()).data;
  const partner = async () => (await data()).partners[0];
  const form = '[data-operation-form]', first = `${form} [data-operation-line="0"]`, dialog = '[data-partner-document-dialog]';
  const openTrading = async () => {
    await tool('partners'); await ready('[data-partner-purchase]'); await click('[data-partner-purchase]'); await ready(form);
    assert.equal(await evaluate(`document.querySelector('[data-partner-purchase]').textContent.trim()`), 'معاملات و تسویه');
    assert.equal(await evaluate(`!!document.querySelector('[data-partner-trading-tab]')`), false);
    assert.equal(await evaluate(`!!document.querySelector('[data-partner-invoice]')`), false);
  };
  const save = async () => {
    const count = (await partner()).entries.length;
    await click('[data-operation-save]');
    await until(`document.querySelector('${form} .form-message.success')`, 'Operation saved');
    assert.equal((await partner()).entries.length, count + 1);
    return (await partner()).entries.at(-1);
  };
  const close = async () => { await click('[data-partner-document-close]'); await until(`!document.querySelector('${dialog}')`); };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com*' }, { urlPattern: '*fonts.gstatic.com*' }] });
  await resize(1440); await go('/register'); await ready('#account-password-confirmation');
  await until(`!document.querySelector('.accounting-submit').disabled`);
  await fill('#account-username', 'partner-trading-browser');
  await fill('#account-gallery-name', 'گالری آزمون معاملات'); await fill('#account-password', 'partner-trading-browser-password');
  await fill('#account-password-confirmation', 'partner-trading-browser-password'); await click('.accounting-submit'); await ready('.workspace-page');
  await tool('partners'); await click('[data-partner-new]'); await fill('[data-partner-profile] [name="name"]', 'همکار معاملات حسابی');
  await fill('[data-partner-profile] [name="tradeType"]', 'melted');
  await click('[data-partner-save]'); await ready('[data-partner-purchase]'); await click('[data-partner-purchase]');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('${first} [name="category"] option')].map(option=>option.value)`), ['melted', 'coin', 'currency']);
  await fields(first, { quantity: 10, rate: 43318000 }); await fields(form, { date: '۱۴۰۵/۰۷/۰۱', cashAmount: '25000000' });
  await screenshot('partner-trading-partial-cash', '[data-partner-trading]');
  const trade = await save();
  assert.deepEqual([(await partner()).goldBalance, (await partner()).tomanBalance], [-10, 75000000]);
  assert.equal((await data()).documents.length, 0);

  await click(`[data-operation-entry="${trade.id}"] [data-operation-edit]`); await ready(`${dialog} ${form}`);
  await fill(`${dialog} [name="cashAmount"]`, '50000000'); await click(`${dialog} [data-operation-save]`);
  await ready(`${dialog} [data-invoice-print]`); assert.equal((await partner()).tomanBalance, 50000000); await close();
  const frozen = JSON.stringify((await partner()).entries);
  await tool('pricing'); await fields('.price-form', { goldGramPrice: 20000000, iqdPrice: 120 });
  await click('.price-form button[type="submit"]'); await ready('.price-form .form-message.success');
  assert.equal(JSON.stringify((await partner()).entries), frozen);
  await openTrading();

  await fields(first, { category: 'currency', currencyType: 'IQD', quantity: 100000, rate: 70 });
  await fields(form, { date: '۱۴۰۵/۰۷/۰۲', cashAmount: '7000000' }); const currencyTrade = await save();
  assert.equal((await partner()).assetBalances['currency:IQD'], -100000);
  assert.equal((await partner()).tomanBalance, 50000000);
  await click('[data-operation-kind="offset"]');
  await fields(first, { asset: 'gold', quantity: 2, rate: 10000000 }); await click('[data-operation-add-line]');
  await fields(`${form} [data-operation-line="1"]`, { asset: 'toman', quantity: 20000000 });
  await fields(form, { date: '۱۴۰۵/۰۷/۰۳' }); const offset = await save();
  assert.deepEqual([(await partner()).goldBalance, (await partner()).tomanBalance], [-8, 30000000]);

  await click('[data-operation-kind="delivery"]');
  const receivedDescriptions = ['دریافت آب‌شده بابت تسویه معامله', 'دریافت دینار طبق رسید بانکی'];
  await fields(first, { meltedWeight: 8, meltedAyar: 750, assayCode: 'AB123', laboratoryName: 'آزمایشگاه دریافت', rate: 43318000, description: receivedDescriptions[0] });
  await click('[data-operation-add-line]');
  await fields(`${form} [data-operation-line="1"]`, { category: 'currency', currencyType: 'IQD', quantity: 100000, rate: 70, description: receivedDescriptions[1] });
  await fields(form, { date: '۱۴۰۵/۰۷/۰۴' });
  const received = await save();
  assert.equal((await partner()).goldBalance, 0); assert.equal((await partner()).assetBalances['currency:IQD'], 0);
  assert.deepEqual(received.lines.map(line => line.description), receivedDescriptions);
  assert.deepEqual((await data()).documents.map(row => row.description).sort(), [...receivedDescriptions].sort());
  await go('/account'); await ready('.workspace-page'); await openTrading();
  const lineDescriptions = async scope => evaluate(`[...document.querySelectorAll(${JSON.stringify(`${scope} [data-partner-line-description]`)})].map(cell=>({description:cell.textContent.trim(),item:cell.closest('tr').querySelector('[data-partner-item-description]')?.textContent.trim()}))`);
  const storedDescriptions = await lineDescriptions(`[data-operation-entry="${received.id}"]`);
  assert.deepEqual(storedDescriptions.map(row => row.description), receivedDescriptions);
  assert.ok(storedDescriptions.every(row => row.item), 'Each description is in the same table row as its asset');
  await click(`[data-operation-entry="${received.id}"] [data-operation-edit]`); await ready(`${dialog} ${form}`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('${dialog} [data-operation-line] [name="description"]')].map(input=>input.value)`), receivedDescriptions);
  receivedDescriptions[0] = 'دریافت آب‌شده؛ شرح اصلاح‌شده';
  await fill(`${dialog} [data-operation-line="0"] [name="description"]`, receivedDescriptions[0]);
  await click(`${dialog} [data-operation-save]`); await ready(`${dialog} [data-invoice-print]`);
  assert.deepEqual((await lineDescriptions(dialog)).map(row => row.description), receivedDescriptions);
  assert.deepEqual((await partner()).entries.find(row => row.id === received.id).lines.map(line => line.description), receivedDescriptions);
  assert.deepEqual((await data()).documents.map(row => row.description).sort(), [...receivedDescriptions].sort());
  await close();
  const currency = (await data()).documents.find(row => row.currencyType === 'IQD');
  assert.equal(inventoryReport((await data()).documents).available.length, 2);
  await fields(first, { category: 'currency', direction: 'pay', inventorySourceId: currency.id, quantity: 1000, description: 'پرداخت بخشی از دینار دریافتی' });
  await fields(form, { date: '۱۴۰۵/۰۷/۰۵' });
  const paid = await save();
  assert.equal(paid.lines[0].description, 'پرداخت بخشی از دینار دریافتی');
  assert.equal((await partner()).assetBalances['currency:IQD'], -1000);
  assert.equal(inventoryReport((await data()).documents).items.find(row => row.id === currency.id).remaining, 99000);
  await screenshot('partner-trading-delivery', '[data-partner-trading]');
  await resize(390, 844);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 2'), 'Mobile page does not overflow');
  await evaluate(`document.querySelector('[data-partner-trading]').scrollIntoView({block:'start',behavior:'instant'})`);
  await screenshot('partner-trading-mobile', '[data-operation-form]'); await resize(1440);

  await click(`[data-operation-entry="${received.id}"] [data-operation-delete]`); await click('[data-confirm-partner-delete]');
  await ready(`${dialog} [role="alert"]`); assert.equal((await partner()).entries.some(row => row.id === received.id), true); await close();
  // Use the same document deletion reached from the vault for a real delivery.
  await tool('vault'); await ready(`[data-inventory-id="${currency.id}"]`);
  await click(`[data-inventory-id="${currency.id}"] > summary`);
  await click(`[data-inventory-id="${currency.id}"] .vault-item-history > summary`);
  await click(`[data-delete-sale="${paid.documentIds[0]}"]`); await click('[data-confirm-partner-delete]'); await until(`!document.querySelector('${dialog}')`);
  assert.equal(inventoryReport((await data()).documents).items.find(row => row.id === currency.id).remaining, 100000);
  await openTrading();
  await click(`[data-operation-entry="${received.id}"] [data-operation-delete]`); await click('[data-confirm-partner-delete]'); await until(`!document.querySelector('${dialog}')`);
  assert.equal((await data()).documents.length, 0);
  assert.deepEqual([(await partner()).goldBalance, (await partner()).assetBalances['currency:IQD']], [-8, -100000]);
  await go('/account'); await ready('.workspace-page'); await openTrading();
  assert.equal((await partner()).tomanBalance, 30000000);
  await click('[data-operation-kind="trade"]');
  await fields(first, { direction: 'sale', inputMode: 'amount', amount: 20000000, rate: 43318000, description: 'فروش آب‌شده در پایان دوره' });
  await fields(form, { date: '۱۴۰۵/۰۷/۰۶', cashDirection: 'receive', cashAmount: 20000000, cashDescription: 'واریز هم‌زمان معامله' });
  await click('[data-operation-add-line]');
  await fields(`${form} [data-operation-line="1"]`, { category: 'coin', coinType: 'گل رز', coinWeight: .3, coinAyar: 999.9, quantity: 2, rate: 4000000, description: 'خرید دو سکه گل رز' });
  const combined = await save();
  assert.equal((await partner()).goldBalance, -6);
  assert.equal((await partner()).tomanBalance, 38000000);
  assert.equal((await partner()).assetBalances['coin:گل رز:0.3:999.9'], -2);

  // A date-bounded account statement carries earlier balances and keeps assets separate.
  const report = '[data-partner-account-statement]';
  await click('[data-partner-account-statement-tab]'); await ready(report);
  const reportBalances = async area => evaluate(`Object.fromEntries([...document.querySelectorAll('${report} [data-statement-${area}] [data-statement-asset]')].map(row=>[row.dataset.statementAsset,Number(row.dataset.balance)]))`);
  const reportEntries = async () => evaluate(`[...document.querySelectorAll('${report} [data-statement-entry]')].map(row=>row.dataset.statementEntry)`);
  await fields(report, { statementFrom: '۱۴۰۵/۰۷/۰۲', statementTo: '۱۴۰۵/۰۷/۰۳' }); await click('[data-partner-statement-apply]');
  assert.deepEqual(await reportEntries(), [currencyTrade.id, offset.id], 'Both date boundaries are included; earlier and later entries are excluded');
  const carried = await reportBalances('opening'), filtered = await reportBalances('final');
  assert.equal(carried.gold, -10); assert.equal(carried.toman, 50000000);
  assert.equal(filtered.gold, -8); assert.equal(filtered.toman, 30000000); assert.equal(filtered['currency:IQD'], -100000);
  assert.equal(filtered['coin:گل رز:0.3:999.9'] || 0, 0, 'Later coin purchase cannot affect the filtered closing account');
  await fields(report, { statementFrom: '۱۴۰۵/۰۷/۰۴' });
  assert.equal(await evaluate(`document.querySelector('[data-partner-statement-print]').disabled`), true, 'Changed dates must be applied before printing');
  await click('[data-partner-statement-apply]'); await ready(`${report} [role="alert"]`);
  assert.deepEqual(await reportEntries(), [currencyTrade.id, offset.id], 'An inverted date range leaves the last valid report intact');
  await fields(report, { statementFrom: '۱۴۰۵/۰۷/۰۱', statementTo: '۱۴۰۵/۰۷/۰۶' }); await click('[data-partner-statement-apply]');
  assert.deepEqual(await reportEntries(), [trade.id, currencyTrade.id, offset.id, combined.id]);
  assert.deepEqual(await reportBalances('final'), { gold: -6, toman: 38000000, 'currency:IQD': -100000, 'coin:گل رز:0.3:999.9': -2 });
  const finalSides = await evaluate(`Object.fromEntries([...document.querySelectorAll('${report} [data-statement-final] [data-statement-asset]')].map(row=>[row.dataset.statementAsset,row.textContent]))`);
  assert.match(finalSides.gold, /باید بگیریم/); assert.match(finalSides.toman, /باید بدهیم/);
  assert.match(finalSides['currency:IQD'], /باید بگیریم/); assert.match(finalSides['coin:گل رز:0.3:999.9'], /باید بگیریم/);
  const reportDescription = await evaluate(`document.querySelector('${report} [data-statement-entry="${combined.id}"]').textContent`);
  for (const description of ['فروش آب‌شده در پایان دوره', 'خرید دو سکه گل رز', 'واریز هم‌زمان معامله']) assert.ok(reportDescription.includes(description), `Statement includes line description: ${description}`);
  assert.ok(await evaluate(`document.querySelectorAll('${report} [data-statement-entry="${combined.id}"] [data-statement-line]').length >= 3`));
  const reportBounds = await evaluate(`(() => {const report=document.querySelector('${report}'), rect=report.getBoundingClientRect();return {left:rect.left,right:rect.right,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,scrollX,clientWidth:report.clientWidth,contentWidth:report.scrollWidth};})()`);
  assert.ok(reportBounds.left >= 0 && reportBounds.right <= reportBounds.viewport + 2 && reportBounds.scrollWidth <= reportBounds.viewport + 2, `Desktop account statement stays inside the page: ${JSON.stringify(reportBounds)}`);
  await screenshot('partner-account-statement', report);
  await resize(390, 844);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 2'), 'Account statement stays inside the mobile page');
  await screenshot('partner-account-statement-mobile', report); await resize(1440);

  // Plain paper printing includes every table border and the final payable/receivable account.
  await evaluate(`window.__statementPrint=false; window.print=()=>{window.__statementPrint=document.body.classList.contains('partner-print-open')&&document.body.classList.contains('partner-account-print-open');}`);
  await click('[data-partner-statement-print]'); assert.equal(await evaluate('window.__statementPrint'), true);
  try {
    await cdp('Emulation.setEmulatedMedia', { media: 'print' });
    const printLayout = await evaluate(`(() => {const report=document.querySelector('${report}'), cells=[...report.querySelectorAll('th,td')], final=report.querySelector('[data-statement-final]'); return {grid:cells.length>0&&cells.every(cell=>['Top','Right','Bottom','Left'].every(side=>parseFloat(getComputedStyle(cell)['border'+side+'Width'])>0&&getComputedStyle(cell)['border'+side+'Style']!=='none')),finalVisible:!!final.getBoundingClientRect().height,controlsHidden:report.querySelector('[data-partner-statement-print]').getBoundingClientRect().height===0,tableFits:[...report.querySelectorAll('table')].every(table=>table.scrollWidth<=table.clientWidth+2)};})()`);
    assert.equal(printLayout.grid, true, 'Every statement cell prints a full grid on plain paper');
    assert.equal(printLayout.finalVisible, true, 'The final account remains visible in print');
    assert.equal(printLayout.controlsHidden, true); assert.equal(printLayout.tableFits, true, 'Printed tables do not clip their content');
    assert.ok(await evaluate(`(() => {const report=document.querySelector('${report}'), rect=report.getBoundingClientRect();return [...report.querySelectorAll('table')].every(table=>{const bounds=table.getBoundingClientRect();return bounds.left>=rect.left-1&&bounds.right<=rect.right+1;});})()`), 'Every printed table stays inside the report bounds');
    await screenshot('partner-account-statement-print', report);
    const pdf = await cdp('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
    assert.ok(Buffer.from(pdf.data, 'base64').length > 1000, 'The browser produces a printable statement PDF');
    await writeFile(resolve('artifacts/partner-account-statement.pdf'), Buffer.from(pdf.data, 'base64'));
  } finally {
    await cdp('Emulation.setEmulatedMedia', { media: '' });
    await evaluate(`window.dispatchEvent(new Event('afterprint'))`);
  }
  await tool('search');
  await click(`.document-card[data-invoice-id="${combined.transactionId}"] [data-invoice-view]`); await ready(`${dialog} [data-operation-details]`);
  assert.equal(await evaluate(`document.querySelectorAll('${dialog} [data-partner-item-description]')[1].textContent`), 'گل رز');
  await evaluate(`window.__operationPrint=false; window.print=()=>{window.__operationPrint=document.body.classList.contains('partner-print-open');window.dispatchEvent(new Event('afterprint'));}`);
  await click(`${dialog} [data-invoice-print]`); assert.equal(await evaluate('window.__operationPrint'), true);
  await click(`${dialog} [data-invoice-delete]`); await click('[data-confirm-partner-delete]'); await until(`!document.querySelector('${dialog}')`);
  assert.equal((await partner()).goldBalance, -8);
  assert.equal((await partner()).assetBalances['coin:گل رز:0.3:999.9'], undefined);

  // Partner type chooses the form in both CRM and the generic entry tools.
  const meltedId = (await partner()).id;
  await tool('partners'); await click('[data-partner-new]');
  await fields('[data-partner-profile]', { name: 'بنکدار با روش قبلی', tradeType: 'wholesaler' });
  await click('[data-partner-save]'); await ready('[data-partner-purchase]');
  const wholesalerId = (await data()).partners.find(row => row.tradeType === 'wholesaler').id;
  assert.equal(await evaluate(`document.querySelector('[data-partner-purchase]').textContent.trim()`), 'فاکتور خرید');
  assert.equal(await evaluate(`!!document.querySelector('[data-partner-trading-tab]')`), false);
  assert.equal(await evaluate(`!!document.querySelector('[data-partner-settlement]') && !!document.querySelector('[data-partner-remittance]')`), true);
  await click('[data-partner-purchase]'); await ready('[data-partner-invoice]');
  assert.equal(await evaluate(`document.querySelector('[data-partner-invoice] [name="category"]').value`), 'crafted');
  assert.equal(await evaluate(`!!document.querySelector('${form}')`), false);
  await click(`[data-partner-id="${meltedId}"]`); await ready(form);
  assert.equal(await evaluate(`!!document.querySelector('[data-partner-invoice]')`), false);
  assert.equal(await evaluate(`!!document.querySelector('[data-partner-settlement]')`), false);
  await tool('partner-crafted-purchase'); await ready('[data-partner-select]');
  await fill('[data-partner-select]', meltedId); await ready(form);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.partner-document-entry > .document-type-select')).display`), 'none');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('${first} [name="category"] option')].map(option=>option.value)`), ['melted', 'coin', 'currency']);
  await fill('[data-partner-select]', wholesalerId); await ready('[data-partner-invoice]');
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.partner-document-entry > .document-type-select')).display`), 'none');
  assert.equal(await evaluate(`!!document.querySelector('${form}')`), false);
  await evaluate(`(() => {const key=Object.keys(localStorage).find(key=>key.endsWith(':partner-workspace')); const saved=JSON.parse(localStorage.getItem(key)); saved.form.view='trading'; saved.form.selectedId=${JSON.stringify(wholesalerId)}; localStorage.setItem(key,JSON.stringify(saved));})()`);
  await go('/account'); await ready('.workspace-page'); await tool('partners'); await ready('[data-partner-invoice]');
  assert.equal(await evaluate(`!!document.querySelector('${form}') || !!document.querySelector('[data-partner-trading-tab]')`), false);
  console.log('PASS: line descriptions survive delivery, reload and editing; date-bounded statements carry opening balances, distinguish all assets and print a full grid with final amounts; existing partner trading and legacy workflows still work.');
}
