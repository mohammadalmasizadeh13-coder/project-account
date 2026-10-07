import assert from 'node:assert/strict';

export async function checkPartnerDocuments({ cdp, evaluate, ready, until, go, fill, click, resize, screenshot, workspace }) {
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com*' }, { urlPattern: '*fonts.gstatic.com*' }] });
  await resize(1440);
  await go('/register'); await ready('#account-password-confirmation');
  await until(`!document.querySelector('.accounting-submit').disabled`);
  await fill('#account-username', 'partner-documents');
  await fill('#account-password', 'partner-browser-test-password');
  await fill('#account-password-confirmation', 'partner-browser-test-password');
  await click('.accounting-submit'); await ready('.workspace-page');
  const open = async type => {
    if (await evaluate(`document.querySelector('.workspace-rail')?.getAttribute('aria-hidden') === 'true'`)) await click('.workspace-menu-toggle');
    await click('[data-section="entries"]');
    await click(`[data-tool="${type}"]`);
    await ready('[data-partner-select]');
    assert.equal(await evaluate(`document.querySelector('[data-document-type]').value`), type);
  };
  await open('partner-remittance');
  await click('[data-partner-new]');
  await fill('[data-partner-profile] [name="name"]', 'همکار آزمایش حواله');
  await click('[data-partner-save]');
  await ready('[data-partner-settlement-form]');
  const success = () => until(`document.querySelector('.partner-crm .form-message.success')`);
  for (const [direction, balance] of [['debit', 10], ['credit', 0]]) {
    await fill('[data-partner-settlement-form] [name="direction"]', direction);
    await fill('[data-partner-settlement-form] [name="goldAmount"]', '۱۰');
    await fill('[data-partner-settlement-form] [name="reference"]', `حواله ${direction}`);
    await click('[data-partner-payment-save]'); await success();
    const saved = await workspace();
    assert.equal(saved.data.partners[0].goldBalance, balance);
    assert.equal(saved.data.partners[0].entries.at(-1).paymentMethod, 'remittance');
    assert.equal(saved.data.documents.length, 0);
  }
  await fill('[data-partner-settlement-form] [name="goldAmount"]', '۷');
  await go('/account'); await ready('.workspace-page'); await open('partner-remittance');
  assert.equal(await evaluate(`document.querySelector('[name="goldAmount"]').value`), '7');
  await resize(390, 844);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
  await screenshot('partner-remittance-mobile', '[data-partner-document-entry]');
  await resize(1440);
  const buy = async (category, values) => {
    await open(`partner-${category}-purchase`);
    for (const [name, value] of Object.entries({ gold18Price: '100000', ...values })) await fill(`[data-partner-invoice] [name="${name}"]`, value);
    await click('[data-partner-invoice-save]'); await success();
    return (await workspace()).data.documents[0];
  };
  const crafted = await buy('crafted', { itemName: 'انگشتر همکار', itemCount: '۳', weight: '۶', ayar: '۷۵۰', wagePercent: '۰', profitPercent: '۰' });
  const coin = await buy('coin', { itemName: 'سکه همکار', coinCount: '۳', coinPrice: '۲۰۰۰۰۰', profitPercent: '۰' });
  assert.equal((await workspace()).data.partners[0].goldBalance, 12);
  for (const [category, stock] of [['crafted', crafted], ['coin', coin]]) {
    await open(`partner-${category}-sale`);
    await fill('[data-partner-invoice] [name="gold18Price"]', '100000');
    await fill('[data-partner-invoice] [name="inventorySourceId"]', stock.id);
    await fill('[data-partner-invoice] [name="profitPercent"]', '۰');
    if (category === 'coin') await fill('[data-partner-invoice] [name="coinPrice"]', '200000');
    if (category === 'crafted') {
      assert.equal(await evaluate(`document.querySelector('[data-partner-line] [name="weight"]').readOnly`), true);
      // Drafts must not mix the purchase and sale of the same category.
      await fill('[data-document-type]', 'partner-crafted-purchase');
      assert.equal(await evaluate(`document.querySelector('[data-partner-line] [name="itemName"]').value`), '');
      await fill('[data-document-type]', 'partner-crafted-sale');
      assert.equal(await evaluate(`document.querySelector('[name="inventorySourceId"]').value`), stock.id);
    }
    await click('[data-partner-invoice-save]'); await success();
    const saved = await workspace();
    assert.equal(saved.data.documents[0].type, `${category}-sale`);
    assert.equal(saved.data.documents[0].inventorySourceId, stock.id);
    assert.equal(saved.data.partners[0].entries.at(-1).goldCredit, 2);
  }
  assert.equal((await workspace()).data.partners[0].goldBalance, 8);
  await go('/account'); await ready('.workspace-page');
  assert.equal((await workspace()).data.partners[0].goldBalance, 8);
  await open('partner-remittance');
  assert.equal(await evaluate(`document.querySelector('[name="goldAmount"]').value`), '7');
  console.log('Partner browser checks passed: debit/credit remittances, reload, mobile, separate drafts, crafted/coin purchases and stock-linked sales.');
}
