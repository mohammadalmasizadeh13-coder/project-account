export const workspaceFields = ['documents', 'customers', 'prices', 'goldPurchases', 'cheques', 'partners'];
const accountingPermissions = new Set(workspaceFields.flatMap(field => [`${field}.read`, `${field}.write`]));
export const can = (user, permission) => accountingPermissions.has(permission)
  && (user?.role === 'owner' || (user?.role === 'staff' && user.permissions?.includes(permission)) || false);
export const writableFields = user => user?.role === 'owner'
  ? [...workspaceFields, 'openingSetup'] : workspaceFields.filter(field => can(user, `${field}.write`));

const toolPermissions = {
  register: ['documents.write', 'customers.write'], expense: ['documents.write'],
  partners: ['partners.read'], 'partner-invoice': ['partners.write', 'documents.write'],
  'partner-remittance': ['partners.write'],
  cheques: ['cheques.write'], pricing: ['prices.write'], 'gold-entry': ['goldPurchases.read'],
  'customer-entry': ['customers.write'], 'settlement-entry': ['customers.write'],
  dashboard: ['documents.read'], profit: ['documents.read'], products: ['documents.read'],
  balance: ['documents.read', 'prices.read', 'goldPurchases.read'], rates: ['prices.read'],
  vault: ['documents.read'], search: ['documents.read'], 'customer-reports': ['customers.read', 'documents.read'],
  'cheque-reports': ['cheques.read'], crm: ['customers.read'], 'crm-occasions': ['customers.read'],
};
const entryKeys = ['register', 'expense', 'cheques', 'pricing', 'gold-entry', 'customer-entry', 'settlement-entry', 'partner-invoice', 'partner-remittance'];
const reportKeys = ['dashboard', 'profit', 'products', 'balance', 'rates', 'vault', 'search', 'customer-reports', 'cheque-reports'];
export function canOpenTool(user, tool) {
  if (user?.role === 'owner') return true;
  if (user?.role !== 'staff') return false;
  if (tool === 'home' || tool === 'settings') return true;
  if (tool === 'crm') return can(user, 'customers.read') || can(user, 'partners.read');
  if (tool === 'register') return can(user, 'documents.write') && (can(user, 'customers.write') || can(user, 'partners.write'));
  if (tool === 'entries') return entryKeys.some(key => canOpenTool(user, key));
  if (tool === 'reports') return reportKeys.some(key => canOpenTool(user, key));
  return !!toolPermissions[tool]?.every(permission => can(user, permission));
}
