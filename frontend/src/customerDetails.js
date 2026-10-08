import { normalizeDigits } from './persianDate.js';
import { iranDate } from './sales.js';

export const customerDetailFields = {
  customerPhone: 'phone', customerBirthDate: 'birthDate',
  customerAddress: 'address', customerNationalId: 'nationalId',
};

const text = value => String(value ?? '').trim();
export function customerDocumentDetails(customer = {}) {
  return Object.fromEntries(Object.entries(customerDetailFields).map(([field, profileField]) =>
    [field, field === 'customerNationalId' ? normalizeDigits(text(customer[profileField])) : text(customer[profileField])]));
}

export function customerProfileDetails(document = {}) {
  return Object.fromEntries(Object.entries(customerDetailFields).map(([field, profileField]) =>
    [profileField, field === 'customerNationalId' ? normalizeDigits(text(document[field])) : text(document[field])]));
}

export function validateCustomerDocumentDetails(form, today = iranDate()) {
  const errors = {};
  const nationalId = normalizeDigits(text(form.customerNationalId));
  if (nationalId && !/^\d{10}$/.test(nationalId)) errors.customerNationalId = 'کد ملی باید ۱۰ رقم باشد.';
  const birthDate = text(form.customerBirthDate);
  if (birthDate) {
    const parsed = new Date(`${birthDate}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthDate) {
      errors.customerBirthDate = 'تاریخ تولد معتبر وارد کنید.';
    } else if (birthDate > today) errors.customerBirthDate = 'تاریخ تولد نمی‌تواند در آینده باشد.';
  }
  for (const [field, label, limit] of [['customerPhone', 'شماره تماس', 100], ['customerAddress', 'آدرس', 5000], ['paymentMethod', 'نحوه پرداخت', 5000]]) {
    if (text(form[field]).length > limit) errors[field] = `${label} باید حداکثر ${limit.toLocaleString('fa-IR')} نویسه باشد.`;
  }
  return errors;
}
