import { isMiscPurchase } from './miscGold.js';

// Apply to new forms and explicit edits, never to historical ledger calculations.
export function profitPercentInput(value, category, record) {
  if (isMiscPurchase(record)) return '0';
  const entered = String(value ?? '').trim();
  return entered || (category === 'crafted' ? '7' : '0');
}
