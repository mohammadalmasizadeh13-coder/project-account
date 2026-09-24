# Zarnegaar Frontend

React/Vite frontend.

## Local

```bash
npm install
npm run dev
```

## Docker

Build and run this frontend separately:

```bash
docker build -t zarnegaar-frontend .
docker run --rm -p 3000:80 zarnegaar-frontend
```

Open `http://localhost:3000`.

## Four-section workspace

The sidebar has four primary destinations:

- Home: today's sales and gross profit, inventory value, three main rates, recent
  documents and compact reminders. It contains no data-entry forms or full reports.
- Entries: purchase/sale documents, opening inventory, cheques, market prices,
  customers, customer settlements and purchases for the gold balance.
- Store reports: sales, gross profit, top products, gold balance, best customers,
  rates, inventory, the document ledger and cheque status. Each report opens
  independently; entry/edit buttons lead to the relevant entry screen.
- CRM: customer profiles, customer reports, and birthdays/follow-ups in separate
  tabs. Individual profiles separate transactions, purchase preferences and
  settlements. Account details are collapsed until requested.

New accounts also start at Home, with a shortcut to opening inventory. Opening
drafts remain intact when switching sections. The mobile sidebar retains the same
four destinations, keyboard focus management and Escape-to-close behavior.

Birthday reminders recur using the Persian month/day, with selectable today,
7-day and 30-day windows. Esfand 30 birthdays are reminded on Esfand 29 in nonleap
years. Home and the notification bell show birthdays through the next seven days;
clicking a reminder opens the customer profile. These are in-app reminders, with
no automatic messages or external notifications.

Gross profit uses the original sale amount less the proportional historical cost
of its linked stock lot, including recorded labor and other entry costs. Opening
stock uses its recorded entry valuation. Unlinked sales or lots with unknown costs
are explicitly excluded, with their count and revenue shown separately. General
store operating expenses are not deducted, so this is not net profit.

## Sales reports

The Persian, right-to-left sales reports cover today,
the last 7 days, and the last 30 days, using dates in Asia/Tehran. Product names on
sales documents determine the per-product breakdown; older documents fall back to
their description or category. Purchases and opening stock are excluded, and sales
use the recorded invoice amount even after gold prices change.

Gold and coin prices are entered manually. No live price service is connected.
Account documents and rates remain in the existing per-user browser storage.

Validation:

```bash
node --test src/*.test.js
npm run build
```

On Windows with Chrome installed in its default location, run
`node dashboard-browser-check.mjs` after building for an isolated browser check.
It checks registration, manual prices, reports, persistence and mobile overflow;
screenshots are written to `artifacts/`. This command now runs the workspace
browser checks, also available directly as `node workspace-browser-check.mjs`.

Navigation uses a right sidebar on desktop and an accessible collapsible drawer
on mobile. Unsaved opening inventory rows remain while switching between menus.
The gold balance is total recorded sales (including credit sales) divided by the
last saved price of one gram of 18-karat gold, less gold purchases entered in the
balance section within the same date range. It can be negative; without a positive
price it stays unavailable. This is a monetary equivalent, separate from physical
sold weight. Each balance purchase is stored with its date and can be removed.

Customer profiles support phone, birthday, address, customer group, notes and a
follow-up date. Date fields accept Persian calendar dates with Persian, Arabic or
Latin digits and retain ISO dates in storage. Trades link to customer IDs; renaming a customer also links older
name-based records. Histories distinguish customer purchases from customer sales.
Positive cash/gold balances mean the customer owes the shop; negative balances
mean the shop owes the customer. Receipts/payments adjust balances with a saved
settlement history. Editing contact information does not add the balance again.
Monetary fields follow the existing application's toman units.

## Cheques and reminders

The Cheques page supports received and issued cheques, registration and due dates,
bank, number, counterparty, amount in toman, notes and editing. Pending, cleared,
bounced and cancelled statuses are recorded manually. Outstanding overdue cheques,
today's cheques and those due within three days appear above the dashboard and in
the header count. The current Tehran date refreshes every minute and when returning
to the app. Opening an alert opens that cheque's editor. Cleared/cancelled cheques
leave the alerts; changing cheque status does not automatically settle customer debt.

Cheques use per-account browser storage, like the existing ledger. Reminders are
in-app; there is no background push notification or SMS service.

Melted gold purchases, sales and opening inventory require a laboratory name next
to the assay number. Names appear in document summaries and are searchable. The
document form groups related fields and shows validation errors beside each field.

After building, `node cheques-browser-check.mjs` runs isolated Windows Chrome checks
for cheque entry, date validation, editing, alerts, persistence and responsive UI.

## Inventory vault

Opening inventory and purchase documents create independent stock lots with stable
codes such as `ZG-000001`. Existing incoming documents receive codes on first load.
Each row represents identical pieces with the recorded per-piece specifications;
use separate rows for different weights or assay numbers. Stock is derived from
incoming documents less sales linked by `inventorySourceId`, so the sale and its
inventory deduction are one stored record. Sold-out lots move out of the available
view but remain in history with their original code and transactions.

Sales require selecting a stock code. Exact code entry accepts Persian/Arabic digits
and fills the category, name, weight, purity, coin type and assay/laboratory details.
Current saved market prices populate the sale price when available. Quantities and
prices remain editable; identified physical specifications are protected. Selling
more pieces than remain, fractional piece counts and selling before receipt are
rejected. Product codes are searchable in the vault and document ledger.

Older sales without stock links are listed explicitly for manual reconciliation;
they are never matched by product name or silently deducted from an arbitrary lot.
Until those sales are linked, the vault warns that its quantities need reconciliation.
Linking preserves the original invoice amounts and customer balances. Like other
account data, the vault persists per account in this browser's local storage.

After building, run `node inventory-browser-check.mjs` for opening inventory,
purchase/sale linkage, code lookup, partial/final sales, historical reconciliation,
overselling protection, persistence, account isolation and responsive layout checks.

## Currencies and asset valuation

Purchase, sale and opening inventory support USD, EUR, AED, GBP and TRY, with a
currency type, rate in tomans per unit and fractional quantity. Currency sales
deduct from the selected lot; currencies remain separate in stock and reports.
The registration page links directly to opening inventory and market rates.
Rates are entered manually; there is no automatic exchange-rate feed.

The vault values remaining quantities at saved market rates, falling back to each
lot's recorded rate. It includes percentage labor, fixed labor per piece, other
costs per unit and recorded percentage profit. Gold valuation respects purity;
Parsian uses its recorded price per piece. Sale discounts and sale-specific costs
do not change the value of unsold pieces. Original invoice amounts stay unchanged
when rates are updated.

The total appears in rials (tomans multiplied by ten), equivalent grams of 750 gold
and equivalent USD. These are alternative valuations of the same inventory, not
cash balances; unavailable conversion rates display a prompt instead of zero.
Physical gold excluding coins, currency quantities and coin counts appear separately.
Receivables, payments and cheques are not included in this inventory valuation.
Bank Emami 86, half 86, quarter 86 and one-gram 86 coins each have independent
rates throughout opening inventory, trading, the vault and the dashboard. Existing
coin types remain available without reclassifying saved records.

The inventory browser check also covers currencies, all four bank-86 variants,
labor and costs, repricing without changing historical invoices, asset totals and
mobile/desktop screenshots (`artifacts/assets-*.png`).

## Customer purchase analytics

CRM includes customer rankings by historical purchase amount, physical item count,
crafted-item count, invoice frequency, average invoice amount, 750-equivalent gold
weight (excluding coins), last purchase and explicitly recorded cash receipts.
Date filters cover all history through today, or the last 30, 90 or 365 days.
Product-group filters affect purchase metrics. Receipt totals use dated received
settlements and are independent of product group; invoice amounts, gold settlements,
outgoing payments and current customer debt are never treated as cash received.

Customer profiles show category spending shares, preferred coin variants, crafted
types and individual products. Coin/crafted preferences can be sorted by quantity
or amount. Currency quantities remain separate from physical item counts. New
crafted entries support an optional explicit type (bangle, bracelet, necklace,
etc.) that follows the stock lot into sales. Existing names are classified using
Persian spelling normalization; unrecognized types remain in Other. Reports are
derived from account documents without duplicating customer purchase records or
changing historical prices. Future-dated transactions and opening stock are excluded.

CRM also identifies overdue follow-ups, customers with no purchases for 90 days,
and repeat buyers who purchased on at least three distinct dates. These status
indicators use lifetime history and do not overwrite manually assigned tags.
Ranking rows open the customer profile. CSV export includes the entire filtered
ranking, Persian UTF-8 text, escaped values and phone-number leading zeros.

`node --test src/*.test.js` checks analytics, financial regressions, Persian birthday
recurrence and historical profit allocation. After building,
`node workspace-browser-check.mjs` checks all four sections, entry routes, report
separation, birthday notifications, CRM preferences/rankings/settlements, draft
preservation, account persistence and mobile layouts. Screenshots are written to
`artifacts/workspace-*.png`. The inventory and cheque browser checks also use the
new four-section navigation.
