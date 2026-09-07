import { getApiUrl } from '@/lib/config';
import { ensureCsrfToken } from '@/lib/auth';
import { withCsrfHeaders } from '@/lib/csrf';
import { ensureUserAvatarProfile } from '@/lib/avatar-profile';

async function parseJsonSafely(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

async function request(path, options = {}) {
  const method = String(options?.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    await ensureCsrfToken();
  }

  const headers = method === 'GET' || method === 'HEAD'
    ? {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      }
    : withCsrfHeaders({
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      });

  const response = await fetch(getApiUrl(path), {
    ...options,
    headers,
    credentials: 'include',
  });

  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    const error = new Error(payload.error || payload.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload.code;
    error.details = payload.details;
    throw error;
  }

  return payload;
}

export function getStoredCurrentUser() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('currentUser');
    return raw ? ensureUserAvatarProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function setStoredCurrentUser(user) {
  if (typeof window === 'undefined') return;
  const normalizedUser = ensureUserAvatarProfile(user || {});
  sessionStorage.setItem('currentUser', JSON.stringify(normalizedUser));
}

export async function getMe() {
  return request('/users/me', { method: 'GET' });
}

export async function getParticipantMe() {
  return request('/participants/me', { method: 'GET' });
}

export async function updateMe(body) {
  return request('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(body || {}),
  });
}

export async function updateMyPassword(currentPassword, newPassword) {
  return request('/users/me/password', {
    method: 'PATCH',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}

export async function updateMyParticipantPassword(currentPassword, newPassword) {
  return request('/participants/me/password', {
    method: 'PATCH',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}

export async function resetMyPassword(userId) {
  return request(`/users/${encodeURIComponent(userId)}/password`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
}

export async function listPricingPlans() {
  const response = await fetch(getApiUrl('/pricing-plans'), { credentials: 'include' });
  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    const error = new Error(payload.error || 'Impossible de charger les formules.');
    error.status = response.status;
    throw error;
  }
  return Array.isArray(payload) ? payload : [];
}

export async function updateMyPlan(pricingPlanId) {
  return request('/users/me/plan', {
    method: 'PATCH',
    body: JSON.stringify({ pricing_plan_id: pricingPlanId }),
  });
}

export async function startBillingCheckout(body) {
  return request('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify(body || {}),
  });
}

export async function startStripeCheckout(body) {
  return startBillingCheckout(body);
}

export async function startPayoneerCheckout(body) {
  return request('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ ...(body || {}), method: 'payoneer' }),
  });
}

export async function createProRequest(body) {
  return request('/billing/pro-request', {
    method: 'POST',
    body: JSON.stringify(body || {}),
  });
}

export async function capturePaypalOrder(body) {
  return request('/billing/paypal/capture', {
    method: 'POST',
    body: JSON.stringify(body || {}),
  });
}
