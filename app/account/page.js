"use client";

import { useEffect, useMemo, useState } from 'react';
import AppNav from '@/components/AppNav';
import AvatarPickerModal from '@/components/AvatarPickerModal';
import Footer from '@/components/Footer';
import Modal from '@/components/ui/Modal';
import ToastContainer from '@/components/ToastContainer';
import useToast from '@/lib/useToast';
import {
  getMe,
  getParticipantMe,
  updateMe,
  updateMyPassword,
  updateMyParticipantPassword,
  resetMyPassword,
  listPricingPlans,
  updateMyPlan,
  capturePaypalOrder,
  startStripeCheckout,
  startPayoneerCheckout,
  getStoredCurrentUser,
  setStoredCurrentUser,
} from '@/lib/account';
import { clearStoredAuth } from '@/lib/auth';
import useI18n from '@/lib/i18n/useI18n';
import { fetchSessionsWithRetry } from '@/lib/api';
import {
  ensureUserAvatarProfile,
  resolveUserAvatar,
  updateUserAvatarProfile,
} from '@/lib/avatar-profile';
import { getPricingPlanBadgeLabel, getPricingPlanVariantLabel, normalizePricingPlanName } from '@/lib/pricing-labels';

const PLAN_HISTORY_STORAGE_KEY = 'accountPlanChangeHistory';
function formatPriceCents(priceCents, currency, locale = 'fr') {
  const amount = Number(priceCents || 0) / 100;
  const currencyCode = String(currency || 'EUR').toUpperCase();
  try {
    return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'fr-FR', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

function buildDhPriceByPlanId(plans) {
  const map = {};
  normalizePlanList(plans).forEach((plan) => {
    const slug = String(plan?.slug || '').toLowerCase();
    const fallbackBySlug = slug.includes('free') ? 0 : slug.includes('session') ? 70 : slug.includes('pro+') || slug.includes('pro-plus') ? 690 : slug.includes('pro') ? 390 : null;
    const cents = Number(plan?.price_mad_cents);
    map[String(plan.id)] = Number.isFinite(cents) && cents >= 0
      ? Math.round(cents / 100)
      : (fallbackBySlug ?? Math.max(0, Math.round(Number(plan?.price_cents || 0) / 100)));
  });
  return map;
}

function formatDhAmount(amountDh) {
  const value = Number(amountDh || 0);
  return `${value} DH`;
}

function normalizeUnknownLocationLabel(location, isCurrent, locale = 'en') {
  const raw = String(location || '').trim();
  const unknownValues = [
    '',
    'unknown',
    'unknown location',
    'n/a',
    'na',
    '-',
  ];
  if (!unknownValues.includes(raw.toLowerCase())) return raw;
  if (isCurrent) {
    return locale === 'en' ? 'Location unavailable - Current device' : 'Emplacement non identifié - appareil actuel';
  }
  return locale === 'en' ? 'Location unavailable' : 'Emplacement non identifié';
}

function normalizeFeatureLabel(feature) {
  const raw = String(feature || '').trim();
  if (!raw) return '';
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, "'")
    .toLowerCase();

  const isExcluded = normalized.includes("pas d") || normalized.startsWith('no ');

  if (normalized.includes('export')) {
    return `${isExcluded ? '❌' : '✓'} CSV/PDF export`;
  }
  if (normalized.includes('insights avances') || normalized.includes('advanced insights')) {
    return `${isExcluded ? '❌' : '✓'} Insights avancés`;
  }

  if (normalized.includes('illimite') || normalized.includes('unlimited')) {
    if (normalized.includes('session')) {
      return `${isExcluded ? '❌' : '✓'} Sessions illimitées`;
    }
  }

  if (normalized.includes('participants max') || normalized.includes('utilisateurs max') || normalized.includes('participants/session')) {
    const numberMatch = raw.match(/\d+/);
    return `${isExcluded ? '❌' : '✓'} ${numberMatch ? `${numberMatch[0]} participants par session` : 'Participants par session'}`;
  }

  if (normalized.includes('sessions') && (normalized.includes('mois') || normalized.includes('month'))) {
    const numberMatch = raw.match(/\d+/);
    return `${isExcluded ? '❌' : '✓'} ${numberMatch ? `${numberMatch[0]} sessions / mois` : 'Sessions / mois'}`;
  }

  if (normalized.includes('catalogue limite') || normalized.includes('catalogue limite') || normalized.includes('limited catalog')) {
    return `${isExcluded ? '❌' : '✓'} Accès au catalogue limité`;
  }

  if (normalized.includes('jusqu') && normalized.includes('participant')) {
    const numberMatch = raw.match(/\d+/);
    return `${isExcluded ? '❌' : '✓'} ${numberMatch ? `Jusqu'a ${numberMatch[0]} participants` : 'Limite de participants'}`;
  }

  if (normalized.includes('dh ht') || normalized.includes('hors taxe')) {
    return `${isExcluded ? '❌' : '✓'} Hors taxes`;
  }

  if (normalized.includes('tout pro') || normalized.includes('all pro')) {
    return `${isExcluded ? '❌' : '✓'} Toutes les fonctionnalites Pro incluses`;
  }

  if (normalized.includes('support prioritaire') || normalized.includes('priority support')) {
    return `${isExcluded ? '❌' : '✓'} Support prioritaire`;
  }

  if (normalized.includes('automatisation') || normalized.includes('automation')) {
    return `${isExcluded ? '❌' : '✓'} Automatisation avancee`;
  }

  if (normalized.includes('personnalisation') || normalized.includes('branding')) {
    return `${isExcluded ? '❌' : '✓'} Personnalisation de marque`;
  }

  if (normalized.includes('integration') || normalized.includes('integrations')) {
    return `${isExcluded ? '❌' : '✓'} Integrations`;
  }

  if (normalized.includes('analytics') || normalized.includes('reporting')) {
    return `${isExcluded ? '❌' : '✓'} Analyses et reporting`;
  }

  const fallback = raw
    .replace(/^\s*[✓✔❌]\s*/u, '')
    .replace(/^\s*pas d[’']?\s*/iu, 'Pas de ')
    .replace(/\s*\/\s*mois/gi, ' / mois')
    .trim();
  return `${isExcluded ? '❌' : '✓'} ${fallback}`;
}

function getCheckoutRedirectUrl(response) {
  const topLevelUrl = String(response?.url || '').trim();
  if (topLevelUrl) return topLevelUrl;
  const paymentCheckoutUrl = String(response?.payment?.checkout_url || '').trim();
  if (paymentCheckoutUrl) return paymentCheckoutUrl;
  return '';
}

function buildInvoiceDownload(entry, locale) {
  const external = String(
    entry?.invoice_pdf_url || entry?.pdf_url || entry?.invoice_url || entry?.receipt_url || ''
  ).trim();
  if (external) {
    return {
      href: external,
      filename: `invoice-${String(entry?.id || Date.now())}.pdf`,
      external: true,
    };
  }

  const invoiceText = [
    locale === 'en' ? 'Invoice' : 'Facture',
    `Reference: ${String(entry?.id || Date.now())}`,
    `${locale === 'en' ? 'Date' : 'Date'}: ${String(entry?.at || '')}`,
    `${locale === 'en' ? 'Plan' : 'Formule'}: ${String(entry?.to || '-')}`,
    `${locale === 'en' ? 'Amount' : 'Montant'}: ${String(entry?.amount_label || '0 DH HT')}`,
  ].join('\n');

  const blob = new Blob([invoiceText], { type: 'application/pdf' });
  return {
    href: URL.createObjectURL(blob),
    filename: `invoice-${String(entry?.id || Date.now())}.pdf`,
    external: false,
  };
}

function resolveHistoryAmountLabel(entry, plans, dhPriceByPlanId) {
  const explicit = String(entry?.amount_label || '').trim();
  if (explicit) {
    return explicit
      .replace(/\bDH\s*HT\b/gi, 'DH HT')
      .replace(/\bExcl\. taxes\b/gi, 'HT');
  }

  const byPlanId = String(entry?.to_plan_id || '').trim();
  if (byPlanId && Object.prototype.hasOwnProperty.call(dhPriceByPlanId, byPlanId)) {
    return `${formatDhAmount(dhPriceByPlanId[byPlanId])} HT`;
  }

  const planName = String(entry?.to || '').trim().toLowerCase();
  if (planName) {
    const match = plans.find((plan) => String(plan?.name || '').trim().toLowerCase() === planName);
    if (match) {
      const amountDh = Number(dhPriceByPlanId[String(match.id)] || 0);
      return `${formatDhAmount(amountDh)} HT`;
    }
  }

  return '0 DH HT';
}

function normalizeDisplayName(user) {
  if (!user || typeof user !== 'object') return 'Manager';
  const first = toNameTitleCase(user.first_name);
  const last = toNameTitleCase(user.last_name);
  const full = `${first} ${last}`.trim();
  return full || String(user.name || user.email || 'Manager');
}

function toNameTitleCase(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  return text
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function normalizePlanList(plans) {
  const list = Array.isArray(plans) ? plans : [];
  return [...list].sort((a, b) => {
    const byOrder = Number(a.display_order || 0) - Number(b.display_order || 0);
    if (byOrder !== 0) return byOrder;
    return Number(a.price_cents || 0) - Number(b.price_cents || 0);
  });
}

function parseHistory() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PLAN_HISTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(entries) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PLAN_HISTORY_STORAGE_KEY, JSON.stringify(entries.slice(0, 15)));
}

function formatDate(dateValue, locale = 'fr') {
  if (!dateValue) return '';
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function formatCount(value, locale = 'fr') {
  const numberValue = Number(value || 0);
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'fr-FR').format(numberValue);
}

function getPlanCycleLabel(locale, me, activePlan) {
  const billingCycle = String(me?.billing_cycle || me?.billing_period || activePlan?.billing_cycle || 'monthly').toLowerCase();
  if (billingCycle === 'annual' || billingCycle === 'yearly') {
    return locale === 'en' ? 'Annual' : 'Annuel';
  }
  return locale === 'en' ? 'Monthly' : 'Mensuel';
}

function getRenewalDate(me, locale = 'fr') {
  const raw = me?.billing_renews_at || me?.current_period_end || me?.renewal_date || me?.next_billing_at || null;
  const formatted = formatDate(raw, locale);
  return formatted || (locale === 'en' ? 'Not scheduled' : 'Non planifiée');
}

function normalizePlanDisplayName(planName) {
  const name = String(planName || '').trim();
  if (!name) return 'Plan';
  if (name.toLowerCase() === 'gratuit') return 'Free';
  return name;
}

function normalizeDepartmentDisplay(value) {
  const text = String(value || '').trim();
  if (text.toLowerCase() === 'human ressource') return 'Ressources humaines';
  return text;
}

function getAccountPlanCopy(plan) {
  const normalizedName = normalizePricingPlanName(plan);
  const planKey = normalizedName.toLowerCase();

  if (planKey === 'free') {
    return {
      displayName: 'Free',
      features: [
        '2 sessions / mois',
        'max 3 participants',
        'accès catalogue limité (3 challenges)',
        'pas d’export',
        'pas d’insights avancés',
      ],
      meta: ['3 utilisateurs max', '2 sessions / mois'],
    };
  }

  if (planKey === 'pay-per-session') {
    return {
      displayName: 'Pay-per-session',
      features: [],
      meta: ['20 utilisateurs max', '1 sessions / mois'],
    };
  }

  if (planKey === 'pro') {
    return {
      displayName: getPricingPlanVariantLabel(plan),
      features: [
        'Sessions illimitées',
        'Jusqu’à 50 participants',
        'Accès catalogue complet',
        'Résultats & scoring',
        'Dashboard manager',
        'Live facilitation',
        'Insights',
      ],
      meta: ['50 utilisateurs max'],
    };
  }

  if (planKey === 'pro+') {
    return {
      displayName: 'Pro +',
      features: [
        'Tout Pro',
        'Multi-managers',
        'Historique sessions',
        'Export CSV/PDF',
        'Insights avancés',
        'Support prioritaire',
      ],
      meta: [],
    };
  }

  return {
    displayName: normalizePlanDisplayName(plan?.name),
    features: Array.isArray(plan?.features) ? plan.features : [],
    meta: [],
  };
}

export default function AccountPage() {
  const { toasts, removeToast, success: showSuccess, error: showError } = useToast();
  const { t, locale, withLocalePath } = useI18n();
  const [guard, setGuard] = useState({ loading: true, allowed: false, user: null });
  const [entrySource, setEntrySource] = useState('');

  const [me, setMe] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  const [profileForm, setProfileForm] = useState({
    first_name: '',
    last_name: '',
    job_title: '',
    department: '',
  });
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [planHistory, setPlanHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('profile');
  const [sessionsThisMonth, setSessionsThisMonth] = useState(0);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState(null);
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [enablingTwoFactor, setEnablingTwoFactor] = useState(false);
  const [signingOutOtherSessions, setSigningOutOtherSessions] = useState(false);
  const [securitySessions, setSecuritySessions] = useState([]);

  useEffect(() => {
    if (!guard.allowed) return;
    let cancelled = false;

    fetchSessionsWithRetry()
      .then((payload) => {
        if (cancelled) return;
        const source = Array.isArray(payload) ? payload : (payload?.sessions || payload?.data || []);
        const list = Array.isArray(source) ? source : [];
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const count = list.filter((session) => {
          const raw = session?.createdAt || session?.created_at || session?.updatedAt || null;
          if (!raw) return false;
          const parsed = new Date(raw);
          if (Number.isNaN(parsed.getTime())) return false;
          return parsed.getFullYear() === y && parsed.getMonth() === m;
        }).length;
        setSessionsThisMonth(count);
      })
      .catch(() => {
        if (!cancelled) setSessionsThisMonth(0);
      });

    return () => {
      cancelled = true;
    };
  }, [guard.allowed]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const source = String(params.get('source') || '').trim().toLowerCase();
    const tab = String(params.get('tab') || '').trim().toLowerCase();
    setEntrySource(source);
    if (['profile', 'security', 'pricing'].includes(tab)) {
      setActiveTab(tab);
    }
  }, []);

  useEffect(() => {
    const current = getStoredCurrentUser();

    if (!current) {
      window.location.replace(withLocalePath('/login'));
      return;
    }

    const normalizedCurrent = ensureUserAvatarProfile(current);
    setStoredCurrentUser(normalizedCurrent);
    setGuard({ loading: false, allowed: true, user: normalizedCurrent });
    if (String(current.role || '').toLowerCase() === 'participant') {
      setActiveTab('security');
    }
  }, []);

  useEffect(() => {
    if (!guard.allowed) return;
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const billing = String(params.get('billing') || '').trim();
    const reference = String(params.get('reference') || '').trim();
    const planId = String(params.get('plan_id') || '').trim() || null;

    if (billing === 'payoneer_return') {
      if (!reference) {
        showError(t('account.payoneerReturnMissingReference'));
        return;
      }

      window.history.replaceState({}, '', window.location.pathname);

      (async () => {
        try {
          const [updatedMe, updatedPlans] = await Promise.all([getMe(), listPricingPlans()]);
          if (updatedMe) {
            setMe(updatedMe);
            setSelectedPlanId(updatedMe.pricing_plan_id ? String(updatedMe.pricing_plan_id) : '');
            const mergedUser = {
              ...(guard.user || {}),
              pricing_plan_id: updatedMe.pricing_plan_id || null,
              pricing_plan: updatedMe.pricing_plan || null,
              picture_url: updatedMe.picture_url || null,
            };
            const withAvatarProfile = ensureUserAvatarProfile(mergedUser);
            setStoredCurrentUser(withAvatarProfile);
            setGuard((prev) => ({ ...prev, user: withAvatarProfile }));
          }
          if (Array.isArray(updatedPlans)) setPlans(normalizePlanList(updatedPlans));

          const planName = updatedMe?.pricing_plan?.name || null;
          showSuccess(
            planName
              ? t('account.payoneerConfirmedWithPlan', { plan: planName })
              : t('account.payoneerConfirmedGeneric')
          );
        } catch (err) {
          showError(err.message || t('account.payoneerConfirmError'));
        }
      })();
      return;
    }

    if (billing !== 'paypal_return') return;

    const paypalToken = String(params.get('token') || '').trim();

    if (!paypalToken) {
      showError(t('account.paypalReturnMissingOrder'));
      return;
    }

    window.history.replaceState({}, '', window.location.pathname);

    (async () => {
      try {
        const result = await capturePaypalOrder({ order_id: paypalToken, pricing_plan_id: planId, billing_cycle: params.get('billing_cycle') || 'monthly' });
        const planName = result?.plan?.name;
        showSuccess(
          planName
            ? t('account.paypalConfirmedWithPlan', { plan: planName })
            : t('account.paypalConfirmedGeneric')
        );

        const [updatedMe, updatedPlans] = await Promise.all([getMe(), listPricingPlans()]);
        const normalizedPlans = Array.isArray(updatedPlans) ? normalizePlanList(updatedPlans) : [];
        const dhMap = buildDhPriceByPlanId(normalizedPlans);
        if (updatedMe) {
          setMe(updatedMe);
          setSelectedPlanId(updatedMe.pricing_plan_id ? String(updatedMe.pricing_plan_id) : '');
          const mergedUser = {
            ...(guard.user || {}),
            pricing_plan_id: updatedMe.pricing_plan_id || null,
            pricing_plan: updatedMe.pricing_plan || null,
            picture_url: updatedMe.picture_url || null,
          };
          const withAvatarProfile = ensureUserAvatarProfile(mergedUser);
          setStoredCurrentUser(withAvatarProfile);
          setGuard((prev) => ({ ...prev, user: withAvatarProfile }));
        }
        if (normalizedPlans.length > 0) setPlans(normalizedPlans);

        const paypalPlanId = String(result?.plan?.id || planId || updatedMe?.pricing_plan_id || '').trim();
        if (paypalPlanId) {
          const amountDh = Number(dhMap[paypalPlanId] || 0);
          const historyEntry = {
            id: Date.now(),
            at: new Date().toISOString(),
            from: '',
            to: result?.plan?.name || updatedMe?.pricing_plan?.name || 'Plan',
            to_plan_id: paypalPlanId,
            amount_dh: amountDh,
            amount_label: `${formatDhAmount(amountDh)} HT`,
            invoice_pdf_url: String(result?.invoice_pdf_url || result?.pdf_url || '').trim() || null,
          };
          const existingHistory = parseHistory();
          const nextHistory = [historyEntry, ...existingHistory].slice(0, 15);
          setPlanHistory(nextHistory);
          saveHistory(nextHistory);
        }
      } catch (err) {
        showError(err.message || t('account.paypalConfirmError'));
      }
    })();
  }, [guard.allowed]);

  useEffect(() => {
    if (!guard.allowed) return;

    let cancelled = false;
    setLoading(true);

    const isParticipantAccount = String(guard.user?.role || '').toLowerCase() === 'participant';
    const accountRequest = isParticipantAccount ? getParticipantMe() : getMe();
    const plansRequest = isParticipantAccount ? Promise.resolve([]) : listPricingPlans();

    Promise.allSettled([accountRequest, plansRequest])
      .then((results) => {
        if (cancelled) return;

        const [meResult, plansResult] = results;
        const mePayload = meResult.status === 'fulfilled' ? meResult.value : null;
        const plansPayload = plansResult.status === 'fulfilled' ? plansResult.value : [];

        if (meResult.status === 'rejected') {
          showError(meResult.reason?.message || t('account.loadAccountError'));
        }

        if (plansResult.status === 'rejected') {
          showError(plansResult.reason?.message || t('account.loadPlansError'));
        }

        const normalizedPlans = normalizePlanList(plansPayload);
        const currentPlanFromMe = mePayload?.pricing_plan;
        const hasCurrentPlanInList = normalizedPlans.some(
          (plan) => String(plan?.id) === String(currentPlanFromMe?.id)
        );

        const mergedPlans = currentPlanFromMe && !hasCurrentPlanInList
          ? normalizePlanList([...normalizedPlans, currentPlanFromMe])
          : normalizedPlans;

        setMe(mePayload || null);
        setPlans(mergedPlans);
        setProfileForm({
          first_name: toNameTitleCase(mePayload?.first_name),
          last_name: toNameTitleCase(mePayload?.last_name),
          job_title: isParticipantAccount ? '' : String(mePayload?.job_title || '').trim(),
          department: isParticipantAccount ? '' : normalizeDepartmentDisplay(mePayload?.department),
        });
        setSelectedPlanId(mePayload?.pricing_plan_id ? String(mePayload.pricing_plan_id) : '');

        const existingHistory = parseHistory();
        setPlanHistory(existingHistory);

        if (mePayload) {
          setGuard((prev) => {
            const mergedUser = {
              ...(prev.user || {}),
              first_name: toNameTitleCase(mePayload?.first_name),
              last_name: toNameTitleCase(mePayload?.last_name),
              name: mePayload?.name,
              job_title: isParticipantAccount ? '' : mePayload?.job_title,
              department: isParticipantAccount ? '' : mePayload?.department,
              picture_url: mePayload?.picture_url || null,
              pricing_plan_id: mePayload?.pricing_plan_id || null,
              pricing_plan: mePayload?.pricing_plan || null,
            };
            const withAvatarProfile = ensureUserAvatarProfile(mergedUser);
            setStoredCurrentUser(withAvatarProfile);
            return { ...prev, user: withAvatarProfile };
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [guard.allowed, guard.user?.role, showError, t]);

  useEffect(() => {
    setTwoFactorEnabled(Boolean(me?.two_factor_enabled || me?.mfa_enabled));
  }, [me?.mfa_enabled, me?.two_factor_enabled]);

  useEffect(() => {
    const resolvedLocationRaw = String(me?.city || me?.country || '').trim() || 'Emplacement non identifie';
    const nowLabel = 'Maintenant';
    const recentLabel = 'Il y a 5 min';
    const currentLocationLabel = normalizeUnknownLocationLabel(resolvedLocationRaw, true, locale);
    setSecuritySessions([
      {
        id: 'current',
        device: 'Navigateur desktop',
        location: currentLocationLabel,
        lastActive: nowLabel,
        isCurrent: true,
        deviceType: 'desktop',
      },
      {
        id: 'recent-mobile',
        device: 'iPhone Safari',
        location: normalizeUnknownLocationLabel('Casablanca, MA', false, locale),
        lastActive: recentLabel,
        isCurrent: false,
        deviceType: 'mobile',
      },
    ]);
  }, [locale, me?.city, me?.country]);

  const userLabel = useMemo(() => normalizeDisplayName(guard.user), [guard.user]);
  const resolvedAvatar = useMemo(() => resolveUserAvatar(guard.user, userLabel), [guard.user, userLabel]);
  const resolvedAvatarUrl = String(resolvedAvatar?.avatarUrl || '').trim();
  const profileIdentityInitials = String(resolvedAvatar?.avatarInitials || 'OB').trim() || 'OB';

  const freePlan = useMemo(() => {
    return plans.find((plan) => {
      const slug = String(plan?.slug || '').toLowerCase();
      const name = String(plan?.name || '').toLowerCase();
      const cents = Number(plan?.price_cents || 0);
      return slug === 'free' || name === 'free' || cents === 0;
    }) || null;
  }, [plans]);

  const currentPlanId = me?.pricing_plan_id
    ? String(me.pricing_plan_id)
    : (freePlan?.id ? String(freePlan.id) : '');

  const activePlan = useMemo(() => {
    if (!currentPlanId) return freePlan;
    return plans.find((plan) => String(plan.id) === currentPlanId) || freePlan;
  }, [plans, currentPlanId, freePlan]);

  const isPaywallEntry = entrySource === 'paywall';
  const isParticipantAccount = String(guard.user?.role || '').toLowerCase() === 'participant';
  const currentPlanLabel = activePlan?.name || t('account.noPlan');
  const historyCount = planHistory.length;
  const roleLabel = isParticipantAccount
    ? 'Participant'
    : String(guard.user?.role || '').toLowerCase() === 'admin'
      ? t('account.roleAdmin')
      : t('account.roleManager');
  const cycleLabel = getPlanCycleLabel(locale, me, activePlan);
  const renewalLabel = getRenewalDate(me, locale);
  const planSeats = activePlan?.max_users || me?.max_users || 0;
  const planSessions = activePlan?.max_sessions_per_month || me?.max_sessions_per_month || 0;
  const dhPriceByPlanId = useMemo(() => buildDhPriceByPlanId(plans), [plans]);
  const sessionLimitValue = Number(planSessions || 0);
  const usageLabel = sessionLimitValue > 0
    ? `${formatCount(sessionsThisMonth, locale)}/${formatCount(sessionLimitValue, locale)} ${locale === 'en' ? 'sessions this month' : 'session ce mois-ci'}`
    : (locale === 'en' ? `${formatCount(sessionsThisMonth, locale)} sessions this month` : `${formatCount(sessionsThisMonth, locale)} session ce mois-ci`);
  const sessionsConsumed = Number(sessionsThisMonth || 0);
  const sessionsQuota = Number(planSessions || 0);
  const sessionsUsagePercent = sessionsQuota > 0 ? Math.min(100, Math.round((sessionsConsumed / sessionsQuota) * 100)) : 0;
  const isFreePlanActive = String(activePlan?.slug || activePlan?.name || '').toLowerCase().includes('free') || Number(activePlan?.price_cents || 0) === 0;
  const usageSubtitle = isFreePlanActive
    ? 'Jusqu’à 3 participants par session - Catalogue limité (3 challenges)'
    : `Jusqu’à ${formatCount(planSeats, 'fr')} participants par session - Accès complet au catalogue`;

  const lastPaidHistory = useMemo(() => {
    if (!Array.isArray(planHistory) || planHistory.length === 0) return null;
    return planHistory.find((entry) => {
      const amount = Number(entry?.amount_dh || 0);
      const toPlan = String(entry?.to || '').toLowerCase();
      return amount > 0 || toPlan.includes('pro');
    }) || null;
  }, [planHistory]);

  const billingStatusHint = useMemo(() => {
    if (!isFreePlanActive || !lastPaidHistory) return '';
    const dateLabel = formatDate(lastPaidHistory.at, 'fr');
    if (dateLabel) {
      return `Votre précédent abonnement Pro s’est terminé le ${dateLabel}.`;
    }
    return 'Votre précédent abonnement Pro est terminé.';
  }, [isFreePlanActive, lastPaidHistory]);

  const recommendedPlan = useMemo(() => {
    const bySlug = plans.find((plan) => String(plan.slug || '').toLowerCase() === 'pro');
    if (bySlug) return bySlug;
    const byName = plans.find((plan) => String(plan.name || '').toLowerCase().includes('pro'));
    return byName || null;
  }, [plans]);

  const isProfileDirty = useMemo(() => {
    const jobNow = String(profileForm.job_title || '').trim();
    const depNow = String(profileForm.department || '').trim();
    const jobBase = String(me?.job_title || '').trim();
    const depBase = String(me?.department || '').trim();
    return jobNow !== jobBase || depNow !== depBase;
  }, [me?.department, me?.job_title, profileForm.department, profileForm.job_title]);

  const passwordChecks = useMemo(() => {
    const candidate = String(passwordForm.new_password || '');
    const hasLength = candidate.length >= 8;
    const hasNumber = /\d/.test(candidate);
    const hasSymbol = /[^A-Za-z0-9]/.test(candidate);
    const score = [hasLength, hasNumber, hasSymbol].filter(Boolean).length;
    const percent = Math.round((score / 3) * 100);
    const level = score <= 1 ? 'weak' : score === 2 ? 'medium' : 'strong';
    return { hasLength, hasNumber, hasSymbol, score, percent, level };
  }, [passwordForm.new_password]);

  async function handleEnable2FA() {
    if (enablingTwoFactor || twoFactorEnabled) return;
    setEnablingTwoFactor(true);
    try {
      setTwoFactorEnabled(true);
      showSuccess('Authentification à deux facteurs activée.');
    } finally {
      setEnablingTwoFactor(false);
    }
  }

  async function handleSignOutOtherDevices() {
    if (signingOutOtherSessions) return;
    setSigningOutOtherSessions(true);
    try {
      setSecuritySessions((prev) => prev.filter((entry) => entry.isCurrent));
      showSuccess('Les autres appareils ont été déconnectés.');
    } finally {
      setSigningOutOtherSessions(false);
    }
  }

  async function handleSaveProfile(event) {
    event.preventDefault();
    if (savingProfile) return;

    setSavingProfile(true);
    try {
      const payload = {
        job_title: profileForm.job_title || null,
        department: normalizeDepartmentDisplay(profileForm.department) || null,
      };
      const updated = await updateMe(payload);
      setMe((prev) => ({
        ...(prev || {}),
        ...updated,
        first_name: profileForm.first_name,
        last_name: profileForm.last_name,
      }));
      showSuccess(t('account.profileUpdated'));
    } catch (err) {
      showError(err.message || t('account.profileUpdateError'));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleUpdatePassword(event) {
    event.preventDefault();
    if (savingPassword) return;

    const currentPassword = String(passwordForm.current_password || '').trim();
    const nextPassword = String(passwordForm.new_password || '').trim();
    const confirmPassword = String(passwordForm.confirm_password || '').trim();

    if (!currentPassword || !nextPassword || !confirmPassword) {
      showError(t('account.passwordAllRequired'));
      return;
    }
    if (nextPassword.length < 8) {
      showError(t('account.passwordMin'));
      return;
    }
    if (nextPassword !== confirmPassword) {
      showError(t('account.passwordConfirmMismatch'));
      return;
    }

    setSavingPassword(true);
    try {
      const isParticipantAccount = String(guard.user?.role || '').toLowerCase() === 'participant';
      await (isParticipantAccount ? updateMyParticipantPassword : updateMyPassword)(currentPassword, nextPassword);
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
      showSuccess(t('account.passwordUpdated'));
    } catch (err) {
      showError(err.message || t('account.passwordUpdateError'));
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleResetPassword() {
    if (resettingPassword || !me?.id) return;

    const confirmed = window.confirm(t('account.passwordResetConfirm'));
    if (!confirmed) return;

    setResettingPassword(true);
    try {
      const result = await resetMyPassword(me.id);
      const temp = String(result?.tempPassword || '').trim();
      if (!temp) {
        showSuccess(t('account.passwordResetDone'));
        return;
      }

      showSuccess(t('account.passwordResetTemp', { temp }));
      if (typeof window !== 'undefined' && navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(temp).catch(() => undefined);
      }
    } catch (err) {
      showError(err.message || t('account.passwordResetError'));
    } finally {
      setResettingPassword(false);
    }
  }

  async function handleChangePlan(event) {
    event.preventDefault();
    if (savingPlan) return;

    const nextPlanId = selectedPlanId || null;
    if (String(nextPlanId || '') === String(currentPlanId || '')) {
      showError(t('account.currentPlanAlreadyActive'));
      return;
    }

    setSavingPlan(true);
    try {
      const updatedUser = await updateMyPlan(nextPlanId);
      const previousPlan = activePlan;
      const latestPlanId = updatedUser?.pricing_plan_id ? String(updatedUser.pricing_plan_id) : '';
      const latestPlan = plans.find((plan) => String(plan.id) === latestPlanId) || null;
      const amountDh = Number(dhPriceByPlanId[latestPlanId] || 0);

      setMe(updatedUser);
      setSelectedPlanId(latestPlanId);

      const mergedUser = {
        ...(guard.user || {}),
        pricing_plan_id: updatedUser?.pricing_plan_id || null,
        pricing_plan: updatedUser?.pricing_plan || null,
      };
      const withAvatarProfile = ensureUserAvatarProfile(mergedUser);
      setStoredCurrentUser(withAvatarProfile);
      setGuard((prev) => ({ ...prev, user: withAvatarProfile }));

      const historyEntry = {
        id: Date.now(),
        at: new Date().toISOString(),
        from: previousPlan ? previousPlan.name : 'Aucune formule',
        to: latestPlan ? latestPlan.name : 'Aucune formule',
        to_plan_id: latestPlanId || null,
        amount_dh: amountDh,
        amount_label: `${formatDhAmount(amountDh)} HT`,
      };
      const nextHistory = [historyEntry, ...planHistory].slice(0, 15);
      setPlanHistory(nextHistory);
      saveHistory(nextHistory);

      showSuccess(t('account.planUpdated'));
    } catch (err) {
      if (err.code === 'PRICING_SCHEMA_UNAVAILABLE') {
        showError(t('account.pricingUnavailable'));
      } else {
        showError(err.message || t('account.planChangeError'));
      }
    } finally {
      setSavingPlan(false);
    }
  }

  async function handleGoToCheckout(method, planId) {
    const targetPlanId = planId || recommendedPlan?.id || activePlan?.id;
    if (!targetPlanId) {
      showError(t('account.noPlanAvailable'));
      return;
    }

    if (String(method).toLowerCase() === 'payoneer') {
      try {
        const result = await startPayoneerCheckout({ pricing_plan_id: targetPlanId });
        if (result?.url) {
          window.location.assign(result.url);
          return;
        }
        showError(result?.message || 'Impossible de démarrer le checkout Payoneer.');
        return;
      } catch (err) {
        showError(err.message || 'Impossible de démarrer le checkout Payoneer.');
        return;
      }
    }

    window.location.assign(
      `${withLocalePath('/account/checkout')}?plan_id=${encodeURIComponent(String(targetPlanId))}&method=${encodeURIComponent(String(method))}`
    );
  }

  async function handleChoosePlan(planId) {
    const targetPlanId = planId || recommendedPlan?.id || activePlan?.id;
    if (!targetPlanId) {
      showError(t('account.noPlanAvailable'));
      return;
    }

    const targetPlan = plans.find((plan) => String(plan.id) === String(targetPlanId)) || null;
    const amountDh = Number(dhPriceByPlanId[String(targetPlanId)] || 0);

    if (amountDh <= 0) {
      setSelectedPlanId(String(targetPlanId));
      showSuccess('Formule Free sélectionnée.');
      return;
    }

    setCheckoutPlan(targetPlan);
    setCheckoutModalOpen(true);
  }

  function closeCheckoutModal() {
    if (openingCheckout) return;
    setCheckoutModalOpen(false);
    setCheckoutPlan(null);
  }

  async function handleStartPlanCheckout(method) {
    const targetPlanId = checkoutPlan?.id;
    if (!targetPlanId || openingCheckout) return;

    setOpeningCheckout(true);
    try {
      if (String(method).toLowerCase() === 'payoneer') {
        const result = await startPayoneerCheckout({ pricing_plan_id: targetPlanId });
        const url = getCheckoutRedirectUrl(result);
        if (!url) throw new Error('Impossible de demarrer le paiement Payoneer.');
        window.location.assign(url);
        return;
      }

      const response = await startStripeCheckout({ pricing_plan_id: targetPlanId, method: 'stripe' });
      const checkoutUrl = getCheckoutRedirectUrl(response);
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }

      window.location.assign(
        `${withLocalePath('/account/checkout')}?plan_id=${encodeURIComponent(String(targetPlanId))}`
      );
    } catch (err) {
      showError(err.message || 'Paiement indisponible.');
    } finally {
      setOpeningCheckout(false);
    }
  }

  function handleDownloadInvoice(entry) {
    const { href, filename, external } = buildInvoiceDownload(entry, locale);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = filename;
    anchor.rel = 'noopener noreferrer';
    anchor.target = external ? '_blank' : '_self';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    if (!external) {
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }
  }

  function logout() {
    clearStoredAuth();
    sessionStorage.removeItem('selectedChallenges');
    window.location.replace(withLocalePath('/login'));
  }

  function handleAvatarSave(selection) {
    const baseUser = guard.user || me || {};
    const nextUser = updateUserAvatarProfile(baseUser, selection);
    setStoredCurrentUser(nextUser);
    setGuard((prev) => ({ ...prev, user: nextUser }));
    setAvatarPickerOpen(false);
    showSuccess('Avatar updated.');
  }

  if (guard.loading || loading) {
    return (
      <main className="shell auth-page">
        <section className="feature-card">
          <h1>{t('account.loadingTitle')}</h1>
          <p>{t('account.loadingBody')}</p>
        </section>
      </main>
    );
  }

  return (
    <>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AppNav
        userLabel={userLabel}
        onLogout={logout}
        role={guard.user?.role}
        avatarUrl={resolvedAvatarUrl}
        avatarInitials={profileIdentityInitials}
      />
      <main className="shell app-home account-page">
        {isPaywallEntry && !isParticipantAccount ? (
          <section className="account-upgrade-banner" aria-label={t('account.paywallAria')}>
            <div className="account-upgrade-banner__body">
              <p className="eyebrow">{t('account.paywallEyebrow')}</p>
              <h2>{t('account.paywallTitle')}</h2>
              <p>{t('account.paywallBody')}</p>
            </div>
            <div className="account-upgrade-banner__actions">
              <button type="button" className="btn-primary" onClick={() => handleGoToCheckout('paypal')}>
                {t('account.checkoutPaypal')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => handleGoToCheckout('payoneer')}>
                Payer avec Payoneer
              </button>
              <button type="button" className="btn-secondary" onClick={() => handleGoToCheckout('bank_transfer')}>
                {t('account.checkoutWire')}
              </button>
            </div>
          </section>
        ) : null}

        <section className="account-page-header" aria-label="En-tête des paramètres du compte">
          <p className="eyebrow">{isParticipantAccount ? 'ESPACE PARTICIPANT' : 'ESPACE MANAGER'}</p>
          <h1>Paramètres du compte</h1>
          <p>
            {isParticipantAccount
              ? 'Consultez votre identifiant et modifiez votre mot de passe depuis cet espace sécurisé.'
              : 'Gérez votre profil, vos options de sécurité et votre abonnement depuis un seul espace.'}
          </p>
        </section>

        <div className="account-card-container">
          <div className="account-tabs account-tabs--modern" role="tablist" aria-label="Sections du compte">
            {!isParticipantAccount ? (
              <button type="button" role="tab" aria-selected={activeTab === 'profile'} className={`account-tab account-tab--modern ${activeTab === 'profile' ? 'is-active' : ''}`} onClick={() => setActiveTab('profile')}>
                Profil
              </button>
            ) : null}
            <button type="button" role="tab" aria-selected={activeTab === 'security'} className={`account-tab account-tab--modern ${activeTab === 'security' ? 'is-active' : ''}`} onClick={() => setActiveTab('security')}>
              Sécurité
            </button>
            {!isParticipantAccount ? (
              <button type="button" role="tab" aria-selected={activeTab === 'pricing'} className={`account-tab account-tab--modern ${activeTab === 'pricing' ? 'is-active' : ''}`} onClick={() => setActiveTab('pricing')}>
                Abonnement et facturation
              </button>
            ) : null}
          </div>

          {!isParticipantAccount ? (
          <section id="account-profile" className={`account-saas-card account-panel ${activeTab === 'profile' ? 'is-active' : ''}`} hidden={activeTab !== 'profile'}>
            <header className="account-saas-card__header">
              <p className="eyebrow">PROFIL</p>
              <h2 className="account-saas-card__title">Paramètres du profil</h2>
              <p className="account-saas-card__subtitle">{t('account.profileSubtitle')}</p>
            </header>
            <div className="account-saas-card__body account-profile-layout">
              <aside className="account-identity-card" aria-label="Résumé de l’identité">
                <div className="account-identity-avatar-wrap">
                  {resolvedAvatarUrl ? (
                    <img src={resolvedAvatarUrl} alt="Avatar sélectionné" className="account-identity-avatar-photo" />
                  ) : (
                    <span className="account-identity-avatar" aria-hidden="true">{profileIdentityInitials}</span>
                  )}
                  <button
                    type="button"
                    className="account-identity-avatar-edit"
                    aria-label="Changer l'avatar"
                    title="JPG, PNG. Max 2MB"
                    aria-haspopup="dialog"
                    aria-expanded={avatarPickerOpen}
                    onClick={() => setAvatarPickerOpen(true)}
                  >
                    ✏️
                  </button>
                </div>
                <div className="account-identity-meta">
                  <p className="account-identity-email" title={String(me?.email || guard.user?.email || '').trim() || '-'}>{String(me?.email || guard.user?.email || '').trim() || '-'}</p>
                  <span className="account-role-badge">Manager</span>
                </div>
              </aside>

              <form className="account-profile-form" onSubmit={handleSaveProfile}>
                <section className="account-profile-group" aria-labelledby="profile-personal-information-title">
                  <h3 id="profile-personal-information-title" className="account-profile-group__title">Informations personnelles</h3>
                  <div className="account-form-grid">
                    <div className="account-form-field">
                      <label className="account-form-label" htmlFor="account-first-name">
                        {t('account.firstName')} <span className="account-field-required" aria-hidden="true">*</span>
                        <span
                          className="account-lock-indicator"
                          aria-label="Champ verrouillé"
                          title="Le prénom est verrouillé et ne peut être modifié que par un administrateur."
                          data-tooltip="Le prénom est verrouillé et ne peut être modifié que par un administrateur."
                        >
                          🔒
                        </span>
                      </label>
                      <input
                        id="account-first-name"
                        className="account-form-input account-form-input--disabled"
                        type="text"
                        value={profileForm.first_name}
                        disabled
                        readOnly
                      />
                    </div>
                    <div className="account-form-field">
                      <label className="account-form-label" htmlFor="account-last-name">
                        {t('account.lastName')} <span className="account-field-required" aria-hidden="true">*</span>
                        <span
                          className="account-lock-indicator"
                          aria-label="Champ verrouillé"
                          title="Le nom est verrouillé et ne peut être modifié que par un administrateur."
                          data-tooltip="Le nom est verrouillé et ne peut être modifié que par un administrateur."
                        >
                          🔒
                        </span>
                      </label>
                      <input
                        id="account-last-name"
                        className="account-form-input account-form-input--disabled"
                        type="text"
                        value={profileForm.last_name}
                        disabled
                        readOnly
                      />
                    </div>
                    <div className="account-form-field account-form-field--full">
                      <label className="account-form-label" htmlFor="account-email">
                        <span>Email <span className="account-field-required" aria-hidden="true">*</span></span>
                      </label>
                      <input
                        id="account-email"
                        className="account-form-input account-form-input--disabled"
                        type="email"
                        value={String(me?.email || guard.user?.email || '').trim()}
                        disabled
                        readOnly
                      />
                      <button type="button" className="account-inline-link account-email-change-link" onClick={handleResetPassword} disabled={resettingPassword}>
                        {resettingPassword ? 'Préparation en cours...' : 'Demander un changement d’e-mail'}
                      </button>
                    </div>
                  </div>
                </section>

                <section className="account-profile-group" aria-labelledby="profile-professional-details-title">
                  <h3 id="profile-professional-details-title" className="account-profile-group__title">Informations professionnelles</h3>
                  <p className="account-group-caption">Les champs marqués d’un * sont obligatoires. Les autres champs sont facultatifs.</p>
                  <div className="account-form-grid">
                    <div className="account-form-field account-form-field--full">
                      <label className="account-form-label" htmlFor="account-job-title">{t('account.jobTitle')} <span className="account-field-optional">(Facultatif)</span></label>
                      <input
                        id="account-job-title"
                        className="account-form-input"
                        type="text"
                        value={profileForm.job_title}
                        onChange={(e) => setProfileForm((prev) => ({ ...prev, job_title: e.target.value }))}
                        placeholder={t('account.jobTitlePlaceholder')}
                      />
                    </div>
                    <div className="account-form-field account-form-field--full">
                      <label className="account-form-label" htmlFor="account-department">{t('account.department')} <span className="account-field-optional">(Facultatif)</span></label>
                      <input
                        id="account-department"
                        className="account-form-input"
                        type="text"
                        value={profileForm.department}
                        onChange={(e) => setProfileForm((prev) => ({ ...prev, department: e.target.value }))}
                        placeholder={t('account.departmentPlaceholder')}
                      />
                    </div>
                  </div>
                </section>

                <div className="account-profile-form-actions">
                  <button type="submit" className="btn-primary account-save-profile-btn" disabled={savingProfile || !isProfileDirty}>
                    {savingProfile ? 'Enregistrement...' : 'Enregistrer les modifications'}
                  </button>
                </div>
              </form>
            </div>
          </section>
          ) : null}

          <section id="account-security" className={`account-saas-card account-panel ${activeTab === 'security' ? 'is-active' : ''}`} hidden={activeTab !== 'security'}>
            <header className="account-saas-card__header">
              <p className="eyebrow">SÉCURITÉ</p>
              <h2 className="account-saas-card__title">Sécurité et accès</h2>
              <p className="account-saas-card__subtitle">Gérez vos identifiants, l’authentification à deux facteurs et les sessions connectées.</p>
            </header>
            <div className="account-saas-card__body account-security-grid">
              <article className="account-security-card">
                <header className="account-security-card__head">
                  <h3>Modifier le mot de passe</h3>
                </header>
                <form className="account-security-form" onSubmit={handleUpdatePassword}>
                  <div className="account-form-field account-form-field--full">
                    <label className="account-form-label account-form-label--with-action" htmlFor="account-current-password">
                      <span>{t('account.currentPassword')}</span>
                      {!isParticipantAccount ? (
                        <button type="button" className="account-inline-link" onClick={handleResetPassword} disabled={resettingPassword}>
                          {resettingPassword ? t('account.generating') : t('account.forgotPassword')}
                        </button>
                      ) : null}
                    </label>
                    <div className="account-password-field">
                      <input
                        id="account-current-password"
                        className="account-form-input"
                        type={showCurrentPassword ? 'text' : 'password'}
                        value={passwordForm.current_password}
                        onChange={(e) => setPasswordForm((prev) => ({ ...prev, current_password: e.target.value }))}
                        placeholder={t('account.currentPasswordPlaceholder')}
                      />
                      <button type="button" className="account-password-toggle" onClick={() => setShowCurrentPassword((prev) => !prev)} aria-label="Afficher ou masquer le mot de passe actuel">
                        👁️
                      </button>
                    </div>
                  </div>

                  <div className="account-form-field account-form-field--full">
                    <label className="account-form-label" htmlFor="account-new-password">{t('account.newPassword')}</label>
                    <div className="account-password-field">
                      <input
                        id="account-new-password"
                        className="account-form-input"
                        type={showNewPassword ? 'text' : 'password'}
                        value={passwordForm.new_password}
                        onChange={(e) => setPasswordForm((prev) => ({ ...prev, new_password: e.target.value }))}
                        placeholder={t('account.newPasswordPlaceholder')}
                        minLength={8}
                      />
                      <button type="button" className="account-password-toggle" onClick={() => setShowNewPassword((prev) => !prev)} aria-label="Afficher ou masquer le nouveau mot de passe">
                        👁️
                      </button>
                    </div>

                    <div className="account-password-strength" role="status" aria-live="polite">
                      <span>Niveau de sécurité du mot de passe</span>
                      <strong>
                        {passwordChecks.level === 'strong'
                          ? 'Fort'
                          : passwordChecks.level === 'medium'
                            ? 'Moyen'
                            : 'Faible'}
                      </strong>
                    </div>
                    <div className="account-password-strength-bar" aria-hidden="true">
                      <span className={`account-password-strength-bar__fill is-${passwordChecks.level}`} style={{ width: `${passwordChecks.percent}%` }} />
                    </div>

                    <ul className="account-password-checklist" aria-label="Exigences du mot de passe">
                      <li className={passwordChecks.hasLength ? 'is-met' : ''}>8 caractères minimum</li>
                      <li className={passwordChecks.hasNumber ? 'is-met' : ''}>Au moins un chiffre</li>
                      <li className={passwordChecks.hasSymbol ? 'is-met' : ''}>Au moins un symbole</li>
                    </ul>
                  </div>

                  <div className="account-form-field account-form-field--full">
                    <label className="account-form-label" htmlFor="account-confirm-password">{t('account.confirmPassword')}</label>
                    <div className="account-password-field">
                      <input
                        id="account-confirm-password"
                        className="account-form-input"
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={passwordForm.confirm_password}
                        onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirm_password: e.target.value }))}
                        placeholder={t('account.confirmPasswordPlaceholder')}
                      />
                      <button type="button" className="account-password-toggle" onClick={() => setShowConfirmPassword((prev) => !prev)} aria-label="Afficher ou masquer la confirmation du mot de passe">
                        👁️
                      </button>
                    </div>
                  </div>

                  <div className="account-security-actions">
                    <button type="submit" className="btn-primary" disabled={savingPassword}>
                      {savingPassword ? t('account.updating') : t('account.changePassword')}
                    </button>
                  </div>
                </form>
              </article>

              <article className="account-security-card">
                <header className="account-security-card__head">
                  <h3>Authentification à deux facteurs (2FA)</h3>
                </header>
                <p className="account-security-card__text">Protégez votre compte avec une étape de vérification supplémentaire à la connexion.</p>
                <p className="account-security-card__hint">Utilisez une application d’authentification comme Google Authenticator ou Authy pour générer des codes temporaires.</p>
                <p className="account-2fa-status">
                  <span>Statut</span>
                  <strong className={twoFactorEnabled ? 'is-enabled' : 'is-disabled'}>{twoFactorEnabled ? 'Activée' : 'Non activée'}</strong>
                </p>
                <button type="button" className="btn-primary account-security-cta" onClick={handleEnable2FA} disabled={enablingTwoFactor || twoFactorEnabled}>
                  {twoFactorEnabled ? '2FA activée' : (enablingTwoFactor ? 'Activation...' : 'Activer la 2FA')}
                </button>
              </article>

              <article className="account-security-card">
                <header className="account-security-card__head">
                  <h3>Sessions actives</h3>
                </header>
                <div className="account-session-list" role="list" aria-label="Liste des sessions actives">
                  {securitySessions.map((session) => (
                    <article key={session.id} role="listitem" className="account-session-item">
                      <div className="account-session-item__icon" aria-hidden="true">{session.deviceType === 'mobile' ? '📱' : '💻'}</div>
                      <div className="account-session-item__meta">
                        <p className="account-session-item__device">{session.device}</p>
                        <dl className="account-session-item__details">
                          <div><dt>Appareil</dt><dd>{session.deviceType === 'mobile' ? 'Mobile' : 'Ordinateur'}</dd></div>
                          <div><dt>Localisation</dt><dd>{session.location}</dd></div>
                          <div><dt>Dernière activité</dt><dd>{session.lastActive}</dd></div>
                        </dl>
                      </div>
                      <div className="account-session-item__status">
                        {session.isCurrent ? (
                          <span className="account-session-badge is-current">Session actuelle</span>
                        ) : (
                          <span className="account-session-badge">Active</span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
                <div className="account-security-actions">
                  <button type="button" className="btn-secondary" onClick={handleSignOutOtherDevices} disabled={signingOutOtherSessions || securitySessions.filter((entry) => !entry.isCurrent).length === 0}>
                    {signingOutOtherSessions ? 'Déconnexion...' : 'Déconnecter les autres appareils'}
                  </button>
                </div>
              </article>
            </div>
          </section>
        </div>

        {!isParticipantAccount ? (
        <section id="account-pricing" className={`account-pricing-section account-panel ${activeTab === 'pricing' ? 'is-active' : ''}`} hidden={activeTab !== 'pricing'}>
          <div className="account-pricing-surface">
            <header className="account-pricing-head">
              <div>
                <p className="eyebrow">ABONNEMENT ET FACTURATION</p>
                <h2>Formules et factures</h2>
                <p>Consultez votre formule actuelle, vos limites d'utilisation et votre historique de facturation.</p>
              </div>
            </header>

            <div className="account-usage-banner" aria-label="Résumé d’utilisation">
              <div className="account-usage-banner__head">
                <p className="account-usage-banner__plan">Formule actuelle : <strong>{isFreePlanActive ? 'Formule Free' : (activePlan?.name || 'Aucune formule')}</strong></p>
              </div>

              <div className="account-usage-progress">
                <div className="account-usage-progress__meta">
                  <span>{formatCount(sessionsConsumed, 'fr')} / {formatCount(sessionsQuota, 'fr')} sessions utilisées ce mois-ci</span>
                </div>
                <div className="account-usage-progress__track" aria-hidden="true">
                  <span className="account-usage-progress__fill" style={{ width: `${sessionsUsagePercent}%` }} />
                </div>
              </div>
              <p className="account-usage-banner__details">{usageSubtitle}</p>
              {billingStatusHint ? <p className="account-usage-banner__hint">{billingStatusHint}</p> : null}
            </div>

            {plans.length > 0 ? (
              <div className="account-plan-cards-grid">
                {plans.map((plan) => {
                  const planCopy = getAccountPlanCopy(plan);
                  const planId = String(plan.id);
                  const isCurrent = planId === String(currentPlanId || '');
                  const isRecommended = recommendedPlan && planId === String(recommendedPlan.id);
                  const isPro = String(plan.slug || plan.name || '').toLowerCase().includes('pro');
                  const isFreePlan = String(plan.slug || plan.name || '').toLowerCase().includes('free') || Number(plan?.price_cents || 0) === 0;
                  const currentPriceCents = Number(activePlan?.price_cents || 0);
                  const planPriceCents = Number(plan?.price_cents || 0);
                  const isUpgrade = isFreePlanActive ? !isFreePlan : planPriceCents > currentPriceCents;
                  const amountDh = Number(dhPriceByPlanId[planId] || 0);
                  const priceFmt = formatDhAmount(amountDh);
                  return (
                    <article
                      key={planId}
                      className={[
                        'pricing-card account-pricing-card',
                        isCurrent ? 'account-pricing-card--current' : '',
                        isRecommended ? 'pricing-card-featured account-pricing-card--recommended' : '',
                        isPro ? 'account-pricing-card--pro' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      <div className="pricing-card-top">
                        {isRecommended ? <span className="pricing-badge account-pricing-badge">{getPricingPlanBadgeLabel(plan) || 'Plus populaire'}</span> : null}
                        {isCurrent ? <span className="account-current-badge">{t('account.yourPlan')}</span> : null}
                        <p className="eyebrow">{planCopy.displayName}</p>
                      </div>
                      <h3 className="pricing-price">
                        {priceFmt}
                        <span>/mois</span>
                      </h3>
                      <p className="pricing-tax-note">HT</p>
                      {plan.description ? <p className="pricing-description">{plan.description}</p> : null}
                      {Array.isArray(planCopy.features) && planCopy.features.length > 0 ? (
                        <ul className="pricing-feature-list">
                          {planCopy.features.map((item, i) => (
                            <li key={i}>{normalizeFeatureLabel(item)}</li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="pricing-meta-row">
                        {planCopy.meta.map((item, index) => <span key={`${planId}-meta-${index}`}>{item}</span>)}
                      </div>
                      {isCurrent ? (
                        <div className="pricing-actions account-plan-card-actions">
                          <button type="button" className="account-plan-card-actions__current" disabled>
                            Formule actuelle
                          </button>
                        </div>
                      ) : (
                        <div className="pricing-actions account-plan-card-actions">
                          <button type="button" className="btn-primary account-plan-card-actions__primary" onClick={() => handleChoosePlan(plan.id)}>
                            {isUpgrade ? 'Passer à Pro' : 'Changer de formule'}
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="field-help">{t('account.noPlans')}</p>
            )}

            {planHistory.length > 0 ? (
              <div className="account-plan-history">
                <p className="eyebrow">HISTORIQUE DE FACTURATION</p>
                <div className="account-history-table-wrap">
                  <table className="account-history-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Formule</th>
                        <th>Montant</th>
                        <th>Statut</th>
                        <th>Facture</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planHistory.map((entry) => (
                        <tr key={String(entry.id)}>
                          <td>{formatDate(entry.at, 'fr')}</td>
                          <td>{entry.to}</td>
                          <td>{resolveHistoryAmountLabel(entry, plans, dhPriceByPlanId)}</td>
                          <td><span className="account-history-status account-history-status--paid">Payée</span></td>
                          <td>
                            <button type="button" className="account-history-link" onClick={() => handleDownloadInvoice(entry)}>📥 Télécharger le PDF</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {planHistory.length === 0 ? (
              <p className="account-history-empty">Aucune facture pour le moment</p>
            ) : null}
          </div>
        </section>
        ) : null}

        <Modal
          open={checkoutModalOpen}
          title="Finaliser le paiement"
          onClose={closeCheckoutModal}
          bodyClassName="account-checkout-modal-body"
        >
          <div className="account-checkout-modal-content">
            <p>
              {`Vous avez sélectionné ${checkoutPlan?.name || 'votre formule'} (${formatDhAmount(Number(dhPriceByPlanId[String(checkoutPlan?.id || '')] || 0))} HT).`}
            </p>
            <div className="account-checkout-modal-actions">
              <button type="button" className="btn-primary" onClick={() => handleStartPlanCheckout('stripe')} disabled={openingCheckout}>
                {openingCheckout ? 'Ouverture du paiement...' : 'Payer avec Stripe'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => handleStartPlanCheckout('payoneer')} disabled={openingCheckout}>
                Payer avec Payoneer
              </button>
            </div>
          </div>
        </Modal>

        <AvatarPickerModal
          open={avatarPickerOpen}
          user={guard.user || me}
          currentSelection={guard.user?.avatar_profile}
          onClose={() => setAvatarPickerOpen(false)}
          onSave={handleAvatarSave}
        />

        <style jsx global>{`
          :root {
            --account-primary: #5b4ce6;
            --account-primary-dark: #4338ca;
            --account-primary-light: #ece9ff;
            --account-border-soft: #e2e8f0;
            --account-card-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
            --account-surface: var(--surface-elevated, #ffffff);
            --account-surface-soft: var(--surface-panel-soft, #f8fbff);
            --account-surface-muted: var(--surface-muted, #f1f5fb);
            --account-text: var(--text-strong, #24324f);
            --account-text-soft: var(--text-muted, #3f4f6a);
            --account-border-strong: var(--control-border, #d6d0ff);
            --account-overlay: var(--modal-scrim, rgba(15, 23, 42, 0.62));
          }

          @media (prefers-color-scheme: dark) {
            :root:not([data-theme='light']) {
              --account-primary: #9eb5ff;
              --account-primary-dark: #c7d5ff;
              --account-primary-light: #1b2b55;
              --account-border-soft: #33445f;
              --account-surface: #111a2e;
              --account-surface-soft: #17233d;
              --account-surface-muted: #22314c;
              --account-text: #f2f6ff;
              --account-text-soft: #cbd5e1;
              --account-border-strong: #6275a0;
            }
          }

          :is(html[data-theme='dark'], body[data-theme='dark'], .dark) .account-page {
            --account-primary: #9eb5ff;
            --account-primary-dark: #c7d5ff;
            --account-primary-light: #1b2b55;
            --account-border-soft: #33445f;
            --account-surface: #111a2e;
            --account-surface-soft: #17233d;
            --account-surface-muted: #22314c;
            --account-text: #f2f6ff;
            --account-text-soft: #cbd5e1;
            --account-border-strong: #6275a0;
          }

          .account-page-header {
            margin: 0 0 1.1rem;
            padding: clamp(1rem, 2vw, 1.5rem) clamp(1rem, 2.4vw, 1.75rem);
            display: grid;
            gap: 0.35rem;
          }

          .account-page-header h1 {
            margin: 0;
          }

          .account-page-header p {
            margin: 0;
            color: var(--account-text-soft);
            max-width: 62ch;
          }

          .account-profile-layout {
            display: grid;
            grid-template-columns: 260px minmax(0, 1fr);
            gap: 1rem;
            align-items: stretch;
          }

          .account-identity-card {
            border: 1px solid color-mix(in srgb, var(--account-border-soft) 68%, transparent);
            border-radius: 10px;
            background: var(--account-surface-soft);
            padding: 1rem;
            display: grid;
            gap: 0.85rem;
            align-content: start;
            height: fit-content;
            box-shadow: var(--account-card-shadow);
          }

          .account-identity-avatar-wrap {
            position: relative;
            width: fit-content;
          }

          .account-identity-avatar {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 3rem;
            height: 3rem;
            border-radius: 999px;
            background: var(--account-primary-light);
            border: 1px solid var(--account-border-strong);
            color: var(--account-primary-dark);
            font-weight: 800;
            letter-spacing: 0.02em;
          }

          .account-identity-avatar-photo {
            width: 3rem;
            height: 3rem;
            border-radius: 999px;
            object-fit: cover;
            border: 1px solid var(--account-border-strong);
            background: var(--account-surface);
          }

          .account-identity-avatar-edit {
            position: absolute;
            right: -0.35rem;
            bottom: -0.35rem;
            width: 1.45rem;
            height: 1.45rem;
            border-radius: 999px;
            border: 1px solid var(--account-border-soft);
            background: var(--account-surface);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 0.7rem;
            line-height: 1;
          }

          .account-identity-meta {
            display: grid;
            gap: 0.5rem;
          }

          .account-identity-email {
            margin: 0;
            color: var(--account-text);
            font-weight: 700;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
          }

          .account-role-badge {
            display: inline-flex;
            align-items: center;
            justify-self: start;
            padding: 0.2rem 0.6rem;
            border-radius: 999px;
            border: 1px solid var(--account-border-strong);
            background: var(--account-primary-light);
            color: var(--account-primary-dark);
            font-weight: 700;
            font-size: 0.8rem;
          }

          .account-profile-form {
            min-height: 100%;
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }

          .account-profile-group {
            border: 1px solid color-mix(in srgb, var(--account-border-soft) 68%, transparent);
            border-radius: 10px;
            background: var(--account-surface);
            padding: 1rem;
            box-shadow: var(--account-card-shadow);
          }

          .account-profile-group__title {
            margin: 0 0 0.75rem;
            font-size: 1rem;
            color: var(--account-text);
          }

          .account-group-caption {
            margin: -0.25rem 0 0.75rem;
            color: var(--account-text-soft);
            font-size: 0.82rem;
          }

          .account-field-required {
            color: var(--error-ink);
            font-weight: 800;
          }

          .account-field-optional {
            color: var(--text-subtle, #64748b);
            font-weight: 600;
            font-size: 0.82rem;
          }

          .account-profile-form-actions {
            margin-top: auto;
            display: flex;
            justify-content: flex-end;
          }

          .account-security-grid {
            display: grid;
            gap: 1rem;
          }

          .account-security-card {
            border: 1px solid color-mix(in srgb, var(--account-border-soft) 68%, transparent);
            border-radius: 10px;
            background: var(--account-surface);
            padding: 1rem;
            display: grid;
            gap: 0.85rem;
            box-shadow: var(--account-card-shadow);
          }

          .account-security-card__head h3 {
            margin: 0;
            font-size: 1rem;
            color: var(--account-text);
          }

          .account-security-card__text {
            margin: 0;
            color: var(--account-text-soft);
          }

          .account-security-card__hint {
            margin: -0.15rem 0 0;
            color: var(--account-text-soft);
            font-size: 0.84rem;
          }

          .account-security-form {
            display: grid;
            gap: 0.95rem;
          }

          .account-password-field {
            position: relative;
          }

          .account-password-field .account-form-input {
            padding-right: 2.6rem;
          }

          .account-password-toggle {
            position: absolute;
            right: 0.5rem;
            top: 50%;
            transform: translateY(-50%);
            border: 1px solid transparent;
            background: transparent;
            cursor: pointer;
            font-size: 0.95rem;
            line-height: 1;
            color: var(--account-text-soft);
            padding: 0.3rem;
            border-radius: 8px;
            transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
          }

          .account-password-toggle:hover,
          .account-password-toggle:focus-visible {
            background: var(--account-surface-muted);
            border-color: var(--account-border-soft);
            color: var(--account-text);
          }

          .account-forgot-inline {
            margin-top: 0.45rem;
            border: none;
            padding: 0;
            background: transparent;
            color: var(--account-primary);
            font-weight: 700;
            font-size: 0.82rem;
            cursor: pointer;
            justify-self: start;
          }

          .account-form-label--with-action {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.75rem;
          }

          .account-inline-link {
            border: none;
            background: transparent;
            color: var(--account-primary);
            font-weight: 700;
            font-size: 0.8rem;
            padding: 0;
            cursor: pointer;
          }

          .account-inline-link:hover,
          .account-inline-link:focus-visible {
            color: var(--account-primary-dark);
            text-decoration: underline;
          }

          .account-inline-link:disabled {
            opacity: 0.7;
            cursor: wait;
          }

          .account-email-change-link {
            justify-self: start;
            margin-top: 0.45rem;
            line-height: 1.35;
            text-align: left;
          }

          .account-forgot-inline:disabled {
            cursor: wait;
            opacity: 0.75;
          }

          .account-password-strength {
            margin-top: 0.5rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.75rem;
            color: var(--account-text-soft);
            font-size: 0.82rem;
          }

          .account-password-strength strong {
            color: var(--account-text);
          }

          .account-password-strength-bar {
            width: 100%;
            height: 0.45rem;
            border-radius: 999px;
            background: var(--account-surface-muted);
            overflow: hidden;
          }

          .account-password-strength-bar__fill {
            display: block;
            height: 100%;
            border-radius: 999px;
            transition: width 180ms ease, background 180ms ease;
          }

          .account-password-strength-bar__fill.is-weak {
            background: #ef4444;
          }

          .account-password-strength-bar__fill.is-medium {
            background: #f59e0b;
          }

          .account-password-strength-bar__fill.is-strong {
            background: #10b981;
          }

          .account-password-checklist {
            margin: 0.55rem 0 0;
            padding: 0;
            list-style: none;
            display: grid;
            gap: 0.3rem;
            color: var(--account-text-soft);
            font-size: 0.82rem;
          }

          .account-password-checklist li::before {
            content: '○';
            margin-right: 0.45rem;
          }

          .account-password-checklist li.is-met {
            color: var(--success-ink);
            font-weight: 600;
          }

          .account-password-checklist li.is-met::before {
            content: '✓';
          }

          .account-security-actions {
            display: flex;
            justify-content: flex-end;
          }

          .account-2fa-status {
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.75rem;
            color: var(--account-text-soft);
          }

          .account-2fa-status strong.is-enabled {
            color: var(--success-ink);
          }

          .account-2fa-status strong.is-disabled {
            color: var(--error-ink);
          }

          .account-session-list {
            display: grid;
            gap: 0.7rem;
          }

          .account-session-item {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto;
            align-items: center;
            gap: 0.75rem;
            border: 1px solid var(--account-border-soft);
            border-radius: 12px;
            padding: 0.72rem 0.78rem;
            background: var(--account-surface);
          }

          .account-session-item__icon {
            width: 2rem;
            height: 2rem;
            border-radius: 999px;
            border: 1px solid var(--account-border-soft);
            background: var(--account-surface-soft);
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }

          .account-session-item__meta {
            min-width: 0;
          }

          .account-session-item__device {
            margin: 0;
            color: var(--account-text);
            font-weight: 700;
            font-size: 0.9rem;
          }

          .account-session-item__details {
            margin: 0.35rem 0 0;
            color: var(--account-text-soft);
            font-size: 0.82rem;
            line-height: 1.35;
          }

          .account-session-item__details div {
            display: grid;
            grid-template-columns: 7.4rem minmax(0, 1fr);
            gap: 0.5rem;
          }

          .account-session-item__details dt,
          .account-session-item__details dd {
            margin: 0;
          }

          .account-session-item__details dt {
            color: var(--account-text);
            font-weight: 700;
          }

          .account-session-badge {
            display: inline-flex;
            align-items: center;
            padding: 0.15rem 0.5rem;
            border-radius: 999px;
            border: 1px solid var(--account-border-soft);
            color: var(--account-text-soft);
            background: var(--account-surface-soft);
            font-weight: 700;
            font-size: 0.74rem;
          }

          .account-session-badge.is-current {
            border-color: var(--account-border-strong);
            background: var(--account-primary-light);
            color: var(--account-primary-dark);
          }

          .account-tabs--modern {
            display: flex;
            flex-wrap: wrap;
            align-items: flex-end;
            gap: 0.35rem;
            margin: 0 0 1rem;
            padding: 0;
            border-bottom: 1px solid var(--account-border-soft);
            background: transparent;
            border-radius: 0;
          }

          .account-tab--modern {
            display: inline-flex;
            align-items: center;
            justify-content: flex-start;
            min-width: 0;
            border: 1px solid transparent;
            border-bottom: 2px solid transparent;
            background: var(--account-surface-soft);
            color: var(--account-text-soft);
            border-radius: 10px 10px 0 0;
            height: 2.5rem;
            padding: 0 1rem;
            margin-bottom: -1px;
            font-weight: 700;
            transition: border-color 180ms ease, color 180ms ease, background 180ms ease;
          }

          .account-tab--modern:hover,
          .account-tab--modern:focus-visible {
            border-color: var(--account-border-strong);
            border-bottom-color: var(--account-border-soft);
            color: var(--account-primary);
            background: var(--account-primary-light);
          }

          .account-tab--modern.is-active {
            border-color: var(--account-border-strong);
            border-bottom-color: var(--account-primary);
            color: var(--account-primary-dark);
            background: var(--account-surface);
          }

          .account-saas-card__header {
            padding: 1.4rem 1.75rem 0.8rem;
          }

          .account-saas-card__subtitle {
            margin: 0.28rem 0 0;
          }

          .account-saas-card__body {
            padding: 1.35rem clamp(2rem, 5vw, 4rem) 1.75rem;
          }

          .account-form-input {
            border: 1px solid var(--account-border-soft);
          }

          .account-form-input::placeholder {
            color: var(--text-subtle, #64748b);
            opacity: 1;
          }

          .account-form-input--disabled,
          .account-form-input:disabled {
            border-color: var(--account-border-soft);
            background: var(--account-surface-muted);
            color: var(--account-text-soft);
            -webkit-text-fill-color: var(--account-text-soft);
            opacity: 1;
          }

          .account-lock-indicator {
            margin-left: 0.28rem;
            font-size: 0.82rem;
            position: relative;
            cursor: help;
          }

          .account-lock-indicator::after {
            content: attr(data-tooltip);
            position: absolute;
            left: 50%;
            bottom: calc(100% + 8px);
            transform: translateX(-50%);
            width: max-content;
            max-width: 220px;
            padding: 0.45rem 0.55rem;
            border-radius: 8px;
            background: var(--account-text);
            color: var(--account-surface);
            font-size: 0.72rem;
            line-height: 1.35;
            white-space: normal;
            opacity: 0;
            pointer-events: none;
            transition: opacity 140ms ease;
            z-index: 3;
          }

          .account-lock-indicator:hover::after,
          .account-lock-indicator:focus-visible::after {
            opacity: 1;
          }

          .account-save-profile-btn:disabled {
            background: var(--account-border-soft) !important;
            color: var(--account-surface) !important;
            box-shadow: none !important;
            cursor: not-allowed;
          }

          .account-plan-pill {
            display: inline-flex;
            align-items: center;
            margin-left: 0.45rem;
            padding: 0.15rem 0.62rem;
            border-radius: 999px;
            background: var(--account-primary-light);
            border: 1px solid var(--account-border-strong);
            color: var(--account-primary-dark);
            font-weight: 700;
            font-size: 0.78rem;
          }

          .account-change-plan-link {
            margin-top: 0.65rem;
            padding: 0;
            border: none;
            background: transparent;
            color: var(--account-primary);
            font-weight: 700;
            font-size: 0.84rem;
            cursor: pointer;
          }

          .account-change-plan-link:hover,
          .account-change-plan-link:focus-visible {
            color: var(--account-primary-dark);
            text-decoration: underline;
          }

          .account-usage-banner {
            border: 1px solid color-mix(in srgb, var(--account-border-soft) 68%, transparent);
            border-radius: 10px;
            background: var(--account-surface-soft);
            padding: 1rem 1.1rem;
            display: grid;
            gap: 0.8rem;
            margin-bottom: 1rem;
            box-shadow: var(--account-card-shadow);
          }

          .account-usage-banner__head {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: flex-start;
            gap: 0.6rem 1rem;
          }

          .account-usage-banner__plan,
          .account-usage-banner__quota {
            margin: 0;
            color: var(--account-text-soft);
            font-size: 0.9rem;
          }

          .account-usage-banner__details {
            margin: 0;
            color: var(--account-text-soft);
            font-size: 0.84rem;
          }

          .account-usage-banner__hint {
            margin: -0.2rem 0 0;
            color: var(--account-text-soft);
            font-size: 0.82rem;
          }

          .account-usage-progress {
            display: grid;
            gap: 0.4rem;
          }

          .account-usage-progress__meta {
            display: flex;
            justify-content: flex-start;
            gap: 0.75rem;
            color: var(--account-text-soft);
            font-size: 0.84rem;
          }

          .account-usage-progress__meta strong {
            color: var(--account-text);
          }

          .account-usage-progress__track {
            width: 100%;
            height: 0.55rem;
            border-radius: 999px;
            background: #edf2fb;
            overflow: hidden;
          }

          .account-usage-progress__fill {
            display: block;
            height: 100%;
            border-radius: 999px;
            background: var(--account-primary);
            transition: width 180ms ease;
          }

          .account-plan-cards-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
            align-items: stretch;
            gap: 1rem;
          }

          .account-pricing-card {
            display: flex;
            flex-direction: column;
            min-height: 100%;
            height: 100%;
            border-radius: 16px;
            border: 1px solid var(--account-border-soft);
            box-shadow: var(--account-card-shadow);
          }

          .account-pricing-card .pricing-price {
            color: var(--account-text);
            font-size: clamp(1.85rem, 2.4vw, 2.25rem);
            line-height: 1;
          }

          .account-pricing-card .pricing-description,
          .account-pricing-card .pricing-tax-note,
          .account-pricing-card .pricing-feature-list,
          .account-pricing-card .pricing-meta-row {
            color: var(--account-text-soft);
          }

          .account-pricing-card .pricing-card-top {
            min-height: 4.6rem;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
          }

          .account-pricing-card .pricing-feature-list {
            flex: 1;
            min-height: 9.5rem;
          }

          .account-pricing-badge {
            align-self: flex-start;
            margin-bottom: 0.45rem;
            background: linear-gradient(135deg, #6d4aff 0%, #4338ca 100%);
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.32);
            box-shadow: 0 8px 18px rgba(91, 76, 230, 0.3);
          }

          .account-pricing-card--current {
            background: var(--color-surface, #f8fafc);
            border-color: var(--color-border, #cbd5e1);
            opacity: 0.98;
          }

          .account-plan-card-actions {
            display: flex;
            flex-direction: column;
            margin-top: auto;
            min-height: 2.75rem;
          }

          .account-plan-card-actions__primary {
            margin-top: auto;
            width: 100%;
          }

          .account-security-cta,
          .account-security-actions .btn-primary,
          .account-security-actions .btn-secondary {
            min-height: 2.5rem;
            border-radius: 10px;
            padding: 0.6rem 1rem;
          }

          .account-plan-card-actions__current {
            width: 100%;
            border: 1px solid var(--account-border-soft);
            border-radius: 10px;
            background: var(--account-surface-muted);
            color: var(--account-text-soft);
            font-weight: 700;
            font-size: 0.88rem;
            padding: 0.62rem 0.75rem;
            cursor: not-allowed;
          }

          .account-pricing-card--recommended {
            border: 1px solid var(--account-primary);
            box-shadow: 0 12px 26px rgba(90, 75, 218, 0.16);
          }

          .account-history-table {
            border-collapse: separate;
            border-spacing: 0;
            width: 100%;
          }

          .account-history-table th,
          .account-history-table td {
            padding: 0.8rem 0.9rem;
            border-bottom: 1px solid var(--account-border-soft);
            color: var(--account-text-soft);
          }

          .account-history-table th {
            font-size: 0.76rem;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            color: var(--account-text);
          }

          .account-history-status--paid {
            display: inline-flex;
            align-items: center;
            padding: 0.18rem 0.55rem;
            border-radius: 999px;
            background: #dcfce7;
            border: 1px solid #bbf7d0;
            color: #166534;
            font-weight: 700;
            font-size: 0.74rem;
          }

          .account-history-link {
            border: 1px solid var(--color-border, #d9e1ef);
            border-radius: 10px;
            background: var(--color-surface, #ffffff);
            color: var(--text-strong, #2f3f5f);
            font-weight: 700;
            font-size: 0.8rem;
            padding: 0.35rem 0.6rem;
            cursor: pointer;
            transition: border-color 160ms ease, background 160ms ease;
          }

          .account-history-link:hover,
          .account-history-link:focus-visible {
            border-color: var(--control-border, #c2cde1);
            background: var(--surface-control-hover, #f8fbff);
          }

          .account-history-empty {
            margin: 0.8rem 0 0;
            color: var(--account-text-soft);
            font-weight: 600;
          }

          .account-checkout-modal-body {
            padding: 0.5rem 0.2rem 0.2rem;
          }

          .account-checkout-modal-content {
            display: grid;
            gap: 1rem;
          }

          .account-checkout-modal-content p {
            margin: 0;
            color: var(--account-text);
          }

          .account-checkout-modal-actions {
            display: grid;
            gap: 0.65rem;
          }

          @media (max-width: 1180px) {
            .account-plan-cards-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          @media (max-width: 640px) {
            .account-profile-layout {
              grid-template-columns: 1fr;
            }

            .account-security-table {
              min-width: 100%;
            }

            .account-plan-cards-grid {
              grid-template-columns: 1fr;
            }
          }
        `}</style>
      </main>
      <Footer />
    </>
  );
}
