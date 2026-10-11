import assert from 'node:assert/strict';
import { navigateWorkspace } from './browser-navigation.mjs';
import { inventoryReport } from './src/inventory.js';

export async function checkPartnerTrading({ cdp, evaluate, ready, until, go, fill, click, resize, screenshot, workspace }) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const tool = async name => {
    if (name !== 'partners') return navigateWorkspace(name, { click, evaluate, pause });
    if (await evaluate(`document.querySelector('.workspace-rail')?.getAttribute('aria-hidden') === 'true'`)) { await click('.workspace-menu-toggle'); await pause(260); }
    await click('[data-section="crm"]'); await click('[data-crm-group="partners"]');
  };
  const fields = async (scope, values) => { for (const [name, value] of Object.entries(values)) await fill(`${scope} [name="${name}"]`, String(value)); };
  const data = async () => (await workspace()).data;
  const partner = async () => (await data()).partners[0];
  const form = '[data-operation-form]', first = `${form} [data-operation-line="0"]`, dialog = '[data-partner-document-dialog]';
  const openTrading = async () => {
    await tool('partners'); await ready('[data-partner-trading-tab]'); await click('[data-partner-trading-tab]'); await ready(form);
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
  await click('[data-partner-save]'); await ready('[data-partner-trading-tab]'); await click('[data-partner-trading-tab]');
  await fields(first, { quantity: 10, rate: 43318000 }); await fill(`${form} [name="cashAmount"]`, '25000000');
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
  await fill(`${form} [name="cashAmount"]`, '7000000'); await save();
  assert.equal((await partner()).assetBalances['currency:IQD'], -100000);
  assert.equal((await partner()).tomanBalance, 50000000);
  await click('[data-operation-kind="offset"]');
  await fields(first, { asset: 'gold', quantity: 2, rate: 10000000 }); await click('[data-operation-add-line]');
  await fields(`${form} [data-operation-line="1"]`, { asset: 'toman', quantity: 20000000 }); await save();
  assert.deepEqual([(await partner()).goldBalance, (await partner()).tomanBalance], [-8, 30000000]);

  await click('[data-operation-kind="delivery"]');
  await fields(first, { meltedWeight: 8, meltedAyar: 750, assayCode: 'AB123', laboratoryName: 'آزمایشگاه دریافت', rate: 43318000 });
  await click('[data-operation-add-line]');
  await fields(`${form} [data-operation-line="1"]`, { category: 'currency', currencyType: 'IQD', quantity: 100000, rate: 70 });
  const received = await save();
  assert.equal((await partner()).goldBalance, 0); assert.equal((await partner()).assetBalances['currency:IQD'], 0);
  const currency = (await data()).documents.find(row => row.currencyType === 'IQD');
  assert.equal(inventoryReport((await data()).documents).available.length, 2);
  await fields(first, { category: 'currency', direction: 'pay', inventorySourceId: currency.id, quantity: 1000 });
  const paid = await save();
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
  await fields(first, { direction: 'sale', inputMode: 'amount', amount: 20000000, rate: 43318000 });
  await fields(form, { cashDirection: 'receive', cashAmount: 20000000 });
  await click('[data-operation-add-line]');
  await fields(`${form} [data-operation-line="1"]`, { category: 'coin', coinType: 'گل رز', coinWeight: .3, coinAyar: 999.9, quantity: 2, rate: 4000000 });
  const combined = await save();
  assert.equal((await partner()).goldBalance, -6);
  assert.equal((await partner()).tomanBalance, 38000000);
  assert.equal((await partner()).assetBalances['coin:گل رز:0.3:999.9'], -2);
  await tool('search');
  await click(`.document-card[data-invoice-id="${combined.transactionId}"] [data-invoice-view]`); await ready(`${dialog} [data-operation-details]`);
  assert.equal(await evaluate(`document.querySelectorAll('${dialog} [data-partner-item-description]')[1].textContent`), 'گل رز');
  await evaluate(`window.__operationPrint=false; window.print=()=>{window.__operationPrint=document.body.classList.contains('partner-print-open');window.dispatchEvent(new Event('afterprint'));}`);
  await click(`${dialog} [data-invoice-print]`); assert.equal(await evaluate('window.__operationPrint'), true);
  await click(`${dialog} [data-invoice-delete]`); await click('[data-confirm-partner-delete]'); await until(`!document.querySelector('${dialog}')`);
  assert.equal((await partner()).goldBalance, -8);
  assert.equal((await partner()).assetBalances['coin:گل رز:0.3:999.9'], undefined);
  console.log('PASS: both gold input modes, fixed rates, partial/full cash, custom coins, IQD, offset, assay receipt, vault deletion/reversal, search, print, reload and mobile.');
}
