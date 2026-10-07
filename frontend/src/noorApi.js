let csrfToken = '';
let accountId = '';

export function setCsrfToken(value = '') { csrfToken = value; }
export function setAccountId(value = '') { accountId = value; }

export async function api(path, options = {}) {
  const { body, ...rest } = options;
  const headers = new Headers(options.headers);
  if (accountId && path.startsWith('/api/owner/')) headers.set('X-Account-ID', accountId);
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase()) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  let response;
  try {
    response = await fetch(path, {
      ...rest, credentials: 'same-origin', cache: 'no-store', headers,
      ...(body === undefined ? {} : { body: isForm ? body : JSON.stringify(body) }),
    });
  } catch (cause) {
    if (cause.name === 'AbortError') throw cause;
    const error = new Error('سرور حسابداری در دسترس نیست. اتصال را بررسی و برنامه را با راه‌انداز حسابداری اجرا کنید.');
    error.status = 0; throw error;
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path.startsWith('/api/owner/')) {
      globalThis.dispatchEvent?.(new Event('noor-session-expired'));
    }
    const detail = payload?.detail;
    const error = new Error(typeof detail === 'string' ? detail : response.status === 422
      ? 'اطلاعات واردشده معتبر نیست؛ مقدار فیلدها را بررسی کنید.' : response.status === 403
        ? 'برای این بخش دسترسی ندارید؛ با مالک حساب هماهنگ کنید.'
        : 'سرور حسابداری پاسخ نمی‌دهد؛ برنامه را با راه‌انداز حسابداری اجرا و دوباره تلاش کنید.');
    error.status = response.status;
    throw error;
  }
  if (response.status !== 204 && payload === null) throw new Error('نشانی سرور درست تنظیم نشده است؛ برنامه را با راه‌انداز حسابداری اجرا کنید.');
  return payload;
}
