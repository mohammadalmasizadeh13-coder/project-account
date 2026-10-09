import assert from 'node:assert/strict';
import { normalizeDigits } from './src/persianDate.js';
import { toolSections } from './src/workspace.js';

// Uses a disposable account/database through the existing browser harness.
export async function checkCoinTrading({ cdp, evaluate, ready, until, go, fill, click, resize, screenshot, workspace }) {
  const fields = async (scope, values) => {
    for (const [name, value] of Object.entries(values)) await fill(`${scope} [name="${name}"]`, value);
  };
  const tool = async name => {
    if (await evaluate(`document.querySelector('.workspace-rail')?.getAttribute('aria-hidden') === 'true'`)) await click('.workspace-menu-toggle');
    await click(`[data-section="${toolSections[name] || 'entries'}"]`);
    await click(`[data-tool="${name}"]`);
  };
  const data = async () => (await workspace()).data;
  const value = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
  const almost = (actual, expected) => assert.ok(Math.abs(Number(String(actual).replace('٫', '.')) - expected) < 0.000001, `${actual} equals ${expected}`);
  const customerForm = '.document-form';
  const partnerForm = '[data-partner-invoice]';

  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com*' }, { urlPattern: '*fonts.gstatic.com*' }] });
  await resize(1440);
  await go('/register'); await ready('#account-password-confirmation');
  await until(`!document.querySelector('.accounting-submit').disabled`);
  await fill('#account-username', 'coin-pricing-browser');
  await fill('#account-gallery-name', 'گالری آزمون سکه');
  await fill('#account-password', 'coin-pricing-browser-password');
  await fill('#account-password-confirmation', 'coin-pricing-browser-password');
  await click('.accounting-submit'); await ready('.workspace-page');
  await tool('pricing');
  await fields('.price-form', { goldGramPrice: '1000000', bankEmami86Price: '12000000', bankHalf86Price: '7000000', bankQuarter86Price: '4000000', bankOneGram86Price: '2000000' });
  await click('.price-form button[type="submit"]'); await ready('.price-form .form-message.success');

  await tool('register');
  await fill('[data-document-type]', 'coin-purchase');
  assert.equal(await evaluate(`document.querySelectorAll('.document-form [name="coinType"] option').length`), 4);
  assert.equal(await value('.document-form [name="coinPrice"]'), '12,000,000');
  await fields(customerForm, { customerName: 'مشتری سکه', itemName: 'تمام عادی مشتری', coinGroup: 'ordinary', coinCount: '2', profitPercent: '10', profitFixed: '50000' });
  almost(normalizeDigits(await value('[data-coin-weight750]')).replaceAll(',', '').replaceAll('٬', ''), 9.7596);
  assert.equal(await evaluate(`document.querySelector('.document-form [name="coinWeight"]').readOnly`), true);
  await screenshot('coin-customer-ordinary');
  await click('.document-form button[type="submit"]'); await ready('.document-form .form-message.success');
  const purchase = (await data()).documents.find(row => row.itemName === 'تمام عادی مشتری');
  assert.ok(purchase);
  almost(purchase.amount, 21571120);
  almost(purchase.coinWeight, 8.133); almost(purchase.coinWeight750, 9.7596);
  almost(purchase.coinAyar, 900);

  await fill('[data-document-type]', 'coin-sale');
  await fill('.document-form [name="productCode"]', purchase.productCode);
  await until(`document.querySelector('.document-form [name="coinGroup"]').disabled`);
  await fields(customerForm, { customerName: 'خریدار سکه', coinCount: '1', gramPrice: '2000000', profitPercent: '5', profitFixed: '10000' });
  await click('.document-form button[type="submit"]'); await ready('[data-invoice-payment-step]');
  await fill('[name="cashPaid"]', '0');
  await click('[data-invoice-payment-confirm]'); await ready('.document-form .form-message.success');
  const sale = (await data()).documents.find(row => row.type === 'coin-sale' && row.inventorySourceId === purchase.id);
  assert.ok(sale); almost(sale.amount, 20505160);
  almost((await data()).documents.find(row => row.id === purchase.id).amount, 21571120);
  await ready('[data-invoice-close]');
  assert.ok((await evaluate(`document.querySelector('.invoice-sheet').textContent`)).includes('۹٫۷۵۹۶'));
  await click('[data-invoice-close]');

  // Custom weight and purity are retained in the customer's new purchase.
  await fill('[data-document-type]', 'coin-purchase');
  await fields(customerForm, { customerName: 'مشتری گل رز', itemName: 'گل رز سفارشی', coinGroup: 'ordinary', coinType: 'گل رز', coinWeight: '0.5', coinAyar: '995', coinCount: '3', profitPercent: '0', profitFixed: '1000' });
  await click('.document-form button[type="submit"]'); await ready('.document-form .form-message.success');
  const rose = (await data()).documents.find(row => row.itemName === 'گل رز سفارشی');
  almost(rose.amount, 1993000); almost(rose.coinWeight, 0.5); almost(rose.coinAyar, 995);

  await tool('partner-coin-purchase');
  await click('[data-partner-new]');
  await fill('[data-partner-profile] [name="name"]', 'همکار سکه');
  await click('[data-partner-save]'); await ready(partnerForm);
  await fields(partnerForm, { gold18Price: '1000000', itemName: 'نیم عادی همکار', coinGroup: 'ordinary', coinType: 'نیم عادی', coinCount: '2', profitPercent: '10', profitFixed: '50000' });
  almost(normalizeDigits(await value('[data-coin-weight750]')).replaceAll(',', '').replaceAll('٬', ''), 4.8792);
  await click('[data-partner-invoice-save]'); await ready('[data-partner-document-dialog] [data-invoice-print]');
  const partnerPurchase = (await data()).documents.find(row => row.itemName === 'نیم عادی همکار');
  almost(partnerPurchase.amount, 10834240);
  almost((await data()).partners[0].goldBalance, 10.83424);
  assert.ok((await evaluate(`document.querySelector('[data-partner-document-dialog]').textContent`)).includes('عیار'));
  await screenshot('coin-partner-document');
  await click('[data-partner-document-close]');

  await tool('partner-coin-sale');
  await fields(partnerForm, { gold18Price: '2000000', inventorySourceId: partnerPurchase.id, coinCount: '1', profitPercent: '0', profitFixed: '10000' });
  await click('[data-partner-invoice-save]'); await ready('[data-partner-document-dialog] [data-invoice-print]');
  const partnerSale = (await data()).documents.find(row => row.type === 'coin-sale' && row.inventorySourceId === partnerPurchase.id);
  almost(partnerSale.amount, 9768400);
  almost((await data()).partners[0].goldBalance, 5.95004);
  await click('[data-partner-document-close]');

  // Bank coins keep their board price even when the gold rate changes.
  await tool('partner-coin-purchase');
  await fields(partnerForm, { gold18Price: '3000000', itemName: 'ربع بانکی همکار', coinType: 'ربع سکه بانکی ۸۶', coinCount: '1', profitPercent: '0', profitFixed: '0' });
  await click('[data-partner-invoice-save]'); await ready('[data-partner-document-dialog] [data-invoice-print]');
  almost((await data()).documents.find(row => row.itemName === 'ربع بانکی همکار').amount, 4000000);
  await click('[data-partner-document-close]');
  await go('/account'); await ready('.workspace-page');
  almost((await data()).documents.find(row => row.id === rose.id).amount, 1993000);
  await tool('search');
  await click(`.document-card[data-invoice-id="${rose.transactionId}"] [data-invoice-view]`);
  await ready('.invoice-sheet'); await click('.invoice-dialog [data-invoice-edit]');
  await fields('.document-editor', { coinType: 'پارسیان', coinWeight: '0.5', coinAyar: '750' });
  await click('[data-confirm-document-action="edit"]');
  await until(`!document.querySelector('.document-editor')`, 'Custom coin edits save');
  almost((await data()).documents.find(row => row.id === rose.id).amount, 1503000);
  if (await evaluate(`!!document.querySelector('[data-invoice-close]')`)) await click('[data-invoice-close]');

  await tool('partner-coin-sale');
  await fields(partnerForm, { gold18Price: '1000000', inventorySourceId: partnerPurchase.id, coinCount: '1', profitPercent: '0', profitFixed: '1000' });
  await click('[data-partner-invoice-save]'); await ready('[data-partner-document-dialog] [data-invoice-edit]');
  const lastPartnerSale = (await data()).partners[0].entries.at(-1);
  await click('[data-partner-document-dialog] [data-invoice-edit]');
  await fields('[data-partner-document-dialog] [data-partner-invoice]', { profitFixed: '2000' });
  await click('[data-partner-document-dialog] [data-partner-invoice-save]');
  await ready('[data-partner-document-dialog] [data-invoice-print]');
  almost((await data()).documents.find(row => row.id === lastPartnerSale.documentIds[0]).amount, 4881200);
  await click('[data-partner-document-close]');
  await tool('register'); await fill('[data-document-type]', 'coin-purchase');
  await fields(customerForm, { coinGroup: 'ordinary', coinType: 'ربع عادی' });
  await resize(390, 844);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'Coin form fits mobile');
  await screenshot('coin-mobile');
  console.log('Coin browser checks passed: customer/partner purchases and sales, custom purity, bank board rates, history and mobile.');
}
