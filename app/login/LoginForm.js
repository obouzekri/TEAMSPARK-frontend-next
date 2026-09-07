"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from 'lucide-react';
import AuthCard from '@/components/AuthCard';
import AuthField from '@/components/AuthField';
import AuthSocialButtons from '@/components/AuthSocialButtons';
import posthog from 'posthog-js';
import { trackGtmEvent, trackProductUserEvent } from '@/lib/analytics';
import {
  clearOAuthCallbackParamsFromUrl,
  ensureCsrfToken,
  getOAuthStartUrl,
  getRedirectPath,
  joinParticipantInstant,
  loginWithFallback,
  readOAuthCallbackFromLocation,
  resendVerification,
  resolveConnectedUserId,
  setStoredAuthSession,
  shouldStoreParticipantTargetSession
} from '@/lib/auth';
import useI18n from '@/lib/i18n/useI18n';

function looksLikeEmail(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function errorMessage(resStatus, data, isEn) {
  if (data?.code === 'ACCOUNT_PENDING') return isEn ? 'Your account is pending admin approval.' : 'Votre compte est en attente de validation par un administrateur.';
  if (data?.code === 'ACCOUNT_REJECTED') return isEn ? 'Your account request was rejected. Contact an administrator.' : 'Votre demande de compte a été refusée. Contactez un administrateur.';
  if (data?.code === 'ACCOUNT_DISABLED') return isEn ? 'This account has been disabled. Contact an administrator.' : 'Ce compte a été désactivé. Contactez un administrateur.';
  if (data?.code === 'EMAIL_NOT_VERIFIED') return isEn ? 'Please verify your email before logging in. Check your inbox and spam folder.' : 'Veuillez confirmer votre adresse email avant de vous connecter. Vérifiez votre boîte mail (et les spams).';
  if (resStatus === 401) return isEn ? 'Invalid email or password.' : 'Email ou mot de passe invalide.';
  return data?.error || (isEn ? 'Something went wrong. Please try again.' : 'Une erreur est survenue. Veuillez réessayer.');
}

const TAB_JOIN = 'join';
const TAB_LOGIN = 'login';
const REMEMBER_IDENTIFIER_STORAGE_KEY = 'tb_remembered_identifier';

function normalizeJoinCode(rawCode) {
  return String(rawCode || '').trim().toUpperCase();
}

function resolveTabFromSearchParams(searchParams, inviteToken) {
  const mode = String(searchParams.get('mode') || '').trim().toLowerCase();
  const code = String(searchParams.get('code') || '').trim();

  if (mode === TAB_LOGIN) return TAB_LOGIN;
  if (mode === TAB_JOIN || code || inviteToken) return TAB_JOIN;
  return TAB_LOGIN;
}

export default function LoginForm({ requestedSessionId = '', requestedInviteToken = '', requestedMode = '', requestedJoinCode = '' }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { locale, withLocalePath } = useI18n();
  const isEn = locale === 'en';
  const normalizedRequestedSessionId = useMemo(() => String(requestedSessionId || '').trim(), [requestedSessionId]);
  const microsoftLoginEnabled = String(process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED || 'false').toLowerCase() === 'true';
  const normalizedRequestedInviteToken = useMemo(() => String(requestedInviteToken || '').trim(), [requestedInviteToken]);
  const initialTab = useMemo(
    () => resolveTabFromSearchParams(searchParams, normalizedRequestedInviteToken),
    [normalizedRequestedInviteToken, searchParams]
  );

  const [activeTab, setActiveTab] = useState(initialTab);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [lastAuthScope, setLastAuthScope] = useState('user');
  const [resendStatus, setResendStatus] = useState('idle');
  const [resendMessage, setResendMessage] = useState('');
  const [oauthLoadingProvider, setOauthLoadingProvider] = useState('');
  const [needsVerificationResend, setNeedsVerificationResend] = useState(false);
  const [identifierTouched, setIdentifierTouched] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [joinCodeInvalid, setJoinCodeInvalid] = useState(false);
  const [joinSessionCode, setJoinSessionCode] = useState('');
  const [joinFirstName, setJoinFirstName] = useState('');
  const [joinLastName, setJoinLastName] = useState('');
  const [joinEmail, setJoinEmail] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinMessage, setJoinMessage] = useState('');
  const [scannerSupported, setScannerSupported] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const joinTabRef = useRef(null);
  const loginTabRef = useRef(null);

  const normalizedIdentifier = useMemo(() => identifier.trim(), [identifier]);
  const identifierIsEmail = useMemo(() => looksLikeEmail(normalizedIdentifier), [normalizedIdentifier]);
  const showIdentifierStatus = identifierTouched && normalizedIdentifier.length > 0 && identifierIsEmail;
  const identifierStatusLabel = identifierIsEmail
    ? (isEn ? 'Email format looks valid' : 'Le format de l’email est valide')
    : (isEn ? 'Participant alias login enabled' : 'Connexion participant par identifiant activee');
  const joinSessionCodeRequired = !normalizedRequestedInviteToken;
  const canSubmitJoin = (Boolean(normalizedRequestedInviteToken) || String(joinSessionCode || '').trim().length > 0)
    && String(joinFirstName || '').trim().length > 0;

  useEffect(() => {
    ensureCsrfToken().catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const remembered = String(localStorage.getItem(REMEMBER_IDENTIFIER_STORAGE_KEY) || '').trim();
      if (remembered) {
        setIdentifier(remembered);
        setRememberMe(true);
      }
    } catch {
      // storage unavailable
    }
  }, []);

  useEffect(() => {
    const hasScanner = typeof window !== 'undefined'
      && typeof navigator !== 'undefined'
      && 'mediaDevices' in navigator
      && typeof window.BarcodeDetector !== 'undefined';
    setScannerSupported(Boolean(hasScanner));
  }, []);

  useEffect(() => {
    const nextTab = resolveTabFromSearchParams(searchParams, normalizedRequestedInviteToken);
    const modeFromServer = String(requestedMode || '').trim().toLowerCase();
    const serverForcedTab = modeFromServer === TAB_LOGIN ? TAB_LOGIN : modeFromServer === TAB_JOIN ? TAB_JOIN : '';
    setActiveTab(serverForcedTab || nextTab);

    const codeFromUrl = normalizeJoinCode(searchParams.get('code'));
    const codeFromServer = normalizeJoinCode(requestedJoinCode);
    const resolvedCode = codeFromUrl || codeFromServer;
    if (resolvedCode) {
      setJoinSessionCode(resolvedCode);
    }
  }, [normalizedRequestedInviteToken, requestedJoinCode, requestedMode, searchParams]);

  useEffect(() => {
    if (!normalizedRequestedInviteToken) return;
    setJoinMessage(isEn ? 'Secure invitation detected. Complete your participant details to join.' : 'Invitation detectee. Completez vos informations pour rejoindre la session.');
  }, [isEn, normalizedRequestedInviteToken]);

  useEffect(() => {
    const oauth = readOAuthCallbackFromLocation();
    if (!oauth.hasOAuthPayload) return;

    clearOAuthCallbackParamsFromUrl();

    if (oauth.error) {
      setMessage(oauth.errorDescription || (isEn ? 'Social login failed. Please try again.' : 'Connexion sociale impossible. Veuillez réessayer.'));
      return;
    }

    if (!oauth.token || !oauth.user) {
      setMessage(isEn ? 'Invalid OAuth response. Please try again.' : 'Réponse OAuth invalide. Veuillez réessayer.');
      return;
    }

    setStoredAuthSession({
      token: oauth.token,
      user: oauth.user,
      targetSessionId: shouldStoreParticipantTargetSession(oauth.user?.role, normalizedRequestedSessionId),
    });

    try {
      posthog.capture('login_oauth', {
        provider: oauth.provider || 'unknown',
        source: 'frontend',
      });
    } catch {
      // no-op
    }

    trackGtmEvent('login_oauth', {
      provider: oauth.provider || 'unknown',
    });

    trackProductUserEvent('oauth_login_success', {
      provider: oauth.provider || 'unknown',
      authMethod: 'oauth',
      userId: resolveConnectedUserId(oauth.user),
      sessionId: normalizedRequestedSessionId || undefined,
      surface: 'login',
    });

    const connectedUserId = resolveConnectedUserId(oauth.user);
    const redirect = withLocalePath(getRedirectPath(oauth.user.role, normalizedRequestedSessionId, connectedUserId));
    window.location.href = redirect;
  }, [isEn, normalizedRequestedSessionId, withLocalePath]);

  function pushTabInUrl(nextTab, nextCode = '') {
    const params = new URLSearchParams(searchParams.toString());
    params.set('mode', nextTab);

    if (nextTab === TAB_JOIN) {
      const normalizedCode = normalizeJoinCode(nextCode);
      if (normalizedCode) {
        params.set('code', normalizedCode);
      }
    } else {
      params.delete('code');
    }

    const query = params.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    router.replace(target, { scroll: false });
  }

  function changeTab(nextTab) {
    if (nextTab === activeTab) return;
    setActiveTab(nextTab);
    pushTabInUrl(nextTab, joinSessionCode);
  }

  function onTabKeyDown(event) {
    const tabs = [TAB_JOIN, TAB_LOGIN];
    const currentIndex = tabs.indexOf(activeTab);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
      const nextTab = tabs[nextIndex];
      changeTab(nextTab);
      if (nextTab === TAB_JOIN) {
        joinTabRef.current?.focus();
      } else {
        loginTabRef.current?.focus();
      }
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      changeTab(TAB_JOIN);
      joinTabRef.current?.focus();
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      changeTab(TAB_LOGIN);
      loginTabRef.current?.focus();
    }
  }

  function startOAuth(provider) {
    const url = getOAuthStartUrl(provider, '/login');
    if (!url) {
      setMessage(provider === 'microsoft'
        ? (isEn ? 'Microsoft login will be available soon.' : 'La connexion Microsoft sera disponible prochainement.')
        : (isEn ? 'OAuth configuration unavailable.' : 'Configuration OAuth indisponible.'));
      return;
    }

    setMessage('');
    setOauthLoadingProvider(provider);
    window.location.href = url;
  }

  async function onSubmit(event) {
    event.preventDefault();
    setMessage('');
    setNeedsVerificationResend(false);
    setResendStatus('idle');
    setResendMessage('');

    if (!normalizedIdentifier || !password) {
      setMessage(isEn ? 'Please fill in all fields.' : 'Veuillez remplir tous les champs.');
      return;
    }

    setLoading(true);
    try {
      const allowParticipantFallback = true;
      const { response, data, authScope } = await loginWithFallback(normalizedIdentifier, password, { allowParticipantFallback });
      setLastAuthScope(authScope || 'user');
      if (response.ok) {
        const token = String(data?.token || '').trim();
        const user = data?.user || null;

        if (!token || !user) {
          setMessage(isEn ? 'Invalid login response. Please try again.' : 'Réponse de connexion invalide. Veuillez réessayer.');
          return;
        }

        const connectedUserId = resolveConnectedUserId(user);
        setStoredAuthSession({
          token,
          user,
          targetSessionId: shouldStoreParticipantTargetSession(user.role, normalizedRequestedSessionId),
        });

        try {
          if (rememberMe) {
            localStorage.setItem(REMEMBER_IDENTIFIER_STORAGE_KEY, normalizedIdentifier);
          } else {
            localStorage.removeItem(REMEMBER_IDENTIFIER_STORAGE_KEY);
          }
        } catch {
          // storage unavailable
        }

        const redirect = withLocalePath(getRedirectPath(user.role, normalizedRequestedSessionId, connectedUserId));
        trackProductUserEvent('login_success', {
          authMethod: 'password',
          userId: connectedUserId,
          sessionId: normalizedRequestedSessionId || undefined,
          surface: 'login',
        });
        window.location.href = redirect;
        return;
      }

      setNeedsVerificationResend(data?.code === 'EMAIL_NOT_VERIFIED');
      setMessage(errorMessage(response.status, data, isEn));
    } catch {
      setMessage(isEn ? 'Unable to reach the server. Check your connection.' : 'Impossible de contacter le serveur. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }

  async function onResendVerification() {
    const normalizedEmail = identifier.trim().toLowerCase();
    if (!normalizedEmail || !looksLikeEmail(normalizedEmail)) {
      setResendStatus('error');
      setResendMessage(isEn ? 'Enter a valid email to resend the link.' : 'Saisissez un email valide pour renvoyer le lien.');
      return;
    }

    setResendStatus('sending');
    setResendMessage(isEn ? 'Sending...' : 'Envoi en cours...');
    try {
      const { res, data } = await resendVerification({
        email: normalizedEmail,
        userType: lastAuthScope === 'participant' ? 'participant' : 'user',
      });

      if (res.ok && data?.success) {
        setResendStatus('done');
        setResendMessage(data?.message || (isEn ? 'A new verification link has been sent.' : 'Un nouveau lien de verification a ete envoye.'));
        return;
      }

      setResendStatus('error');
      setResendMessage(data?.message || data?.error || (isEn ? 'Unable to resend the link right now.' : 'Impossible de renvoyer le lien pour le moment.'));
    } catch {
      setResendStatus('error');
      setResendMessage(isEn ? 'Unable to reach the server. Check your connection and try again.' : 'Impossible de contacter le serveur. Verifiez votre connexion et reessayez.');
    }
  }

  async function onJoinInstant(event) {
    event.preventDefault();
    setJoinMessage('');
    setJoinCodeInvalid(false);

    const sessionCode = String(joinSessionCode || '').trim();
    const firstName = String(joinFirstName || '').trim();
    const lastName = String(joinLastName || '').trim();
    const email = String(joinEmail || '').trim();
    const inviteToken = normalizedRequestedInviteToken;

    if ((!sessionCode && !inviteToken) || !firstName || !lastName) {
      setJoinMessage(isEn ? 'Session code, first name, and last name are required.' : 'Le code session, le prenom et le nom sont requis.');
      return;
    }

    if (email && !looksLikeEmail(email)) {
      setJoinMessage(isEn ? 'Enter a valid email address.' : 'Saisissez une adresse email valide.');
      return;
    }

    setJoinLoading(true);
    try {
      const { res, data } = await joinParticipantInstant({
        sessionCode,
        inviteToken,
        firstName,
        lastName,
        email,
        nickname: firstName,
      });
      if (!res.ok) {
        const codeRejected = res.status === 404 || data?.code === 'SESSION_NOT_FOUND';
        setJoinCodeInvalid(codeRejected);
        setJoinMessage(codeRejected
          ? (isEn ? 'Invalid code.' : 'Code invalide.')
          : (data?.error || (isEn ? 'Unable to join session right now.' : 'Impossible de rejoindre la session pour le moment.')));
        return;
      }

      const token = String(data?.token || '').trim();
      const user = data?.user || null;
      const resolvedSessionId = String(data?.sessionId || '').trim();
      if (!token || !user) {
        setJoinMessage(isEn ? 'Invalid join response. Please try again.' : 'Reponse de connexion invalide. Veuillez reessayer.');
        return;
      }

      setStoredAuthSession({
        token,
        user,
        targetSessionId: shouldStoreParticipantTargetSession('participant', resolvedSessionId),
      });

      if (data?.temporaryPassword) {
        sessionStorage.setItem('participantTemporaryCredentials', JSON.stringify({
          identifier: user.email,
          password: data.temporaryPassword,
        }));
      }

      const redirect = withLocalePath(getRedirectPath('participant', '', resolveConnectedUserId(user)));
      window.location.href = redirect;
    } catch {
      setJoinMessage(isEn ? 'Unable to reach the server. Check your connection.' : 'Impossible de contacter le serveur. Verifiez votre connexion.');
    } finally {
      setJoinLoading(false);
    }
  }

  async function startQrScanner() {
    if (!scannerSupported || scannerActive) return;

    setJoinMessage('');
    setScannerActive(true);

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' }
        }
      });

      const video = document.createElement('video');
      video.setAttribute('playsinline', 'true');
      video.srcObject = stream;
      await video.play();

      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });

      const stopStream = () => {
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
      };

      const maxAttempts = 180;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const codes = await detector.detect(video);
        if (Array.isArray(codes) && codes.length > 0) {
          const rawValue = String(codes[0]?.rawValue || '').trim();
          if (rawValue) {
            const match = rawValue.match(/(?:sessionCode|session_code|code|session)=([A-Za-z0-9_-]+)/i);
            const extracted = String(match?.[1] || rawValue).trim().toUpperCase();
            setJoinSessionCode(extracted);
            pushTabInUrl(TAB_JOIN, extracted);
            setJoinMessage(isEn ? 'QR code detected. Session code pre-filled.' : 'QR detecte. Code session pre-rempli.');
            stopStream();
            setScannerActive(false);
            return;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      stopStream();
      setJoinMessage(isEn ? 'No QR code detected. Please try again.' : 'Aucun QR detecte. Veuillez reessayer.');
    } catch {
      setJoinMessage(isEn ? 'Camera unavailable or permission denied.' : 'Camera indisponible ou permission refusee.');
    } finally {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      setScannerActive(false);
    }
  }

  return (
    <main className="auth-page auth-page--login">
      <div className={`auth-login-pane auth-login-pane--${activeTab}`}>
        <AuthCard
          title={isEn ? 'Access TeamBlender' : 'Accéder à TeamBlender'}
          footer={<span>{isEn ? 'New to TeamBlender? ' : 'Nouveau sur TeamBlender ? '}<Link href={withLocalePath('/signup')}>{isEn ? 'Create an account' : 'Créer un compte'}</Link></span>}
        >
          <div className="auth-tabs" role="tablist" aria-label={isEn ? 'Select connection mode' : 'Selectionner le mode de connexion'}>
            <button
              ref={joinTabRef}
              type="button"
              role="tab"
              id="login-tab-join"
              aria-controls="login-panel-join"
              aria-selected={activeTab === TAB_JOIN}
              tabIndex={activeTab === TAB_JOIN ? 0 : -1}
              className={`auth-tab-btn${activeTab === TAB_JOIN ? ' is-active' : ''}`}
              onClick={() => changeTab(TAB_JOIN)}
              onKeyDown={onTabKeyDown}
            >
              {isEn ? 'Join with a code' : 'Rejoindre avec un code'}
            </button>
            <button
              ref={loginTabRef}
              type="button"
              role="tab"
              id="login-tab-login"
              aria-controls="login-panel-login"
              aria-selected={activeTab === TAB_LOGIN}
              tabIndex={activeTab === TAB_LOGIN ? 0 : -1}
              className={`auth-tab-btn${activeTab === TAB_LOGIN ? ' is-active' : ''}`}
              onClick={() => changeTab(TAB_LOGIN)}
              onKeyDown={onTabKeyDown}
            >
              {isEn ? 'Member area login' : 'Connexion Espace Membre'}
            </button>
          </div>

          <p className="auth-tabs-subtitle" aria-live="polite">
            {activeTab === TAB_JOIN
              ? (isEn
                ? 'Quick guest access with the code shared by your organizer.'
                : 'Accès rapide invité avec le code transmis par votre organisateur.')
              : (isEn
                ? 'For organizers and participants registered by their manager.'
                : 'Pour les organisateurs et les participants inscrits par leur manager.')}
          </p>

          <div
            id="login-panel-join"
            role="tabpanel"
            aria-labelledby="login-tab-join"
            hidden={activeTab !== TAB_JOIN}
            className="auth-tab-panel"
          >
            <form onSubmit={onJoinInstant} className="auth-form auth-form--join" autoComplete="off">
              <AuthField id="join-session-code" label={isEn ? 'Session code *' : 'Code de session *'}>
                <input
                  id="join-session-code"
                  type="text"
                  value={joinSessionCode}
                  onChange={(e) => {
                    const value = normalizeJoinCode(e.target.value);
                    setJoinSessionCode(value);
                    pushTabInUrl(TAB_JOIN, value);
                  }}
                  placeholder={isEn ? 'Ex: AB12' : 'Ex: AB12'}
                  autoComplete="off"
                  required={joinSessionCodeRequired}
                  className="join-field-input join-session-code-input join-session-code-placeholder"
                  disabled={Boolean(normalizedRequestedInviteToken)}
                />
              </AuthField>
              {scannerSupported ? (
                <button
                  type="button"
                  className="btn-secondary wide"
                  onClick={startQrScanner}
                  disabled={scannerActive}
                  aria-busy={scannerActive}
                >
                  {scannerActive
                    ? (isEn ? 'Scanning QR...' : 'Scan QR en cours...')
                    : (isEn ? 'Scan QR with camera' : 'Scanner le QR avec la camera')}
                </button>
              ) : null}
              <div className="auth-field-grid auth-field-grid--join">
                <AuthField id="join-first-name" label={isEn ? 'First name *' : 'Prénom *'}>
                  <input
                    id="join-first-name"
                    type="text"
                    value={joinFirstName}
                    onChange={(e) => setJoinFirstName(e.target.value)}
                    placeholder={isEn ? 'Sophie' : 'Sophie'}
                    autoComplete="given-name"
                    className="join-field-input"
                    required
                  />
                </AuthField>
                <AuthField id="join-last-name" label={isEn ? 'Last name *' : 'Nom *'}>
                  <input
                    id="join-last-name"
                    type="text"
                    value={joinLastName}
                    onChange={(e) => setJoinLastName(e.target.value)}
                    placeholder={isEn ? 'Martin' : 'Martin'}
                    autoComplete="family-name"
                    className="join-field-input"
                    required
                  />
                </AuthField>
              </div>
              <AuthField id="join-email" label={isEn ? 'Email (optional)' : 'Adresse e-mail (optionnel)'}>
                <input
                  id="join-email"
                  type="email"
                  value={joinEmail}
                  onChange={(e) => setJoinEmail(e.target.value)}
                  placeholder={isEn ? 'sophie@company.com' : 'sophie@entreprise.com'}
                  autoComplete="email"
                  className="join-field-input"
                />
              </AuthField>
              <button
                type="submit"
                className="btn-primary wide login-submit-btn join-submit-btn"
                disabled={joinLoading || !canSubmitJoin}
                aria-busy={joinLoading}
              >
                {joinLoading ? (isEn ? 'Joining...' : 'Connexion...') : <>{isEn ? 'Join session' : 'Rejoindre la session'} <span aria-hidden="true">→</span></>}
              </button>
              {joinMessage ? (
                <p className="form-error">
                  {joinMessage}
                  {joinCodeInvalid ? (
                    <>
                      {' '}
                      {isEn ? 'No code yet? ' : 'Vous n’avez pas de code ? '}
                      <Link href={withLocalePath('/contact')} className="auth-inline-help-link">
                        {isEn ? 'Contact your organizer.' : 'Contactez votre organisateur.'}
                      </Link>
                    </>
                  ) : null}
                </p>
              ) : null}
            </form>
            <p className="auth-required-note">* {isEn ? 'Required fields' : 'Champs obligatoires'}</p>
          </div>

          <div
            id="login-panel-login"
            role="tabpanel"
            aria-labelledby="login-tab-login"
            hidden={activeTab !== TAB_LOGIN}
            className="auth-tab-panel"
          >
            <AuthSocialButtons
              loading={loading}
              loadingProvider={oauthLoadingProvider}
              microsoftEnabled={microsoftLoginEnabled}
              stacked
              googleLabelOverride={isEn ? 'Continue with Google' : 'Continuer avec Google'}
              separatorLabelOverride={isEn ? 'OR CONTINUE WITH YOUR EMAIL' : 'OU CONTINUER AVEC VOTRE E-MAIL'}
              onProviderClick={(provider) => startOAuth(provider)}
            />

            <form onSubmit={onSubmit} className="auth-form" autoComplete="off">
              <AuthField
                id="login-email"
                label={isEn ? 'Email or participant alias' : 'Email ou identifiant participant'}
                icon={<Mail size={18} strokeWidth={1.9} />}
                after={showIdentifierStatus ? (
                  <span className={`auth-input-status${identifierIsEmail ? ' is-valid' : ''}`} aria-label={identifierStatusLabel} title={identifierStatusLabel}>
                    <CheckCircle2 size={16} strokeWidth={2} />
                  </span>
                ) : null}
              >
                <input
                  id="login-email"
                  type="text"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    setIdentifierTouched(true);
                  }}
                  onBlur={() => setIdentifierTouched(true)}
                  required
                  placeholder={isEn ? 'you@company.com or sophie' : 'vous@entreprise.com ou sophie'}
                  autoComplete="email"
                  aria-label={isEn ? 'Email or participant alias' : 'Email ou identifiant participant'}
                  aria-invalid={showIdentifierStatus ? String(false) : undefined}
                />
              </AuthField>

              <AuthField id="login-password" label={isEn ? 'Password' : 'Mot de passe'} icon={<LockKeyhole size={18} strokeWidth={1.9} />} className="auth-field--password">
                <div className="password-input-wrap">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder={isEn ? 'Your password' : 'Votre mot de passe'}
                    autoComplete="current-password"
                    aria-label={isEn ? 'Password' : 'Mot de passe'}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-controls="login-password"
                    aria-label={showPassword ? (isEn ? 'Hide password' : 'Masquer le mot de passe') : (isEn ? 'Show password' : 'Afficher le mot de passe')}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={18} strokeWidth={1.9} aria-hidden="true" /> : <Eye size={18} strokeWidth={1.9} aria-hidden="true" />}
                  </button>
                </div>
              </AuthField>

              <div className="auth-form-row auth-form-row--options">
                <label className="auth-remember-me" htmlFor="login-remember-me">
                  <input
                    id="login-remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>{isEn ? 'Remember me' : 'Se souvenir de moi'}</span>
                </label>
                <Link href={withLocalePath('/forgot-password')} className="auth-inline-help-link">
                  {isEn ? 'Forgot password?' : 'Mot de passe oublié ?'}
                </Link>
              </div>

              <button type="submit" className="btn-primary wide login-submit-btn" disabled={loading} aria-busy={loading}>
                {loading ? (
                  <>
                    <LoaderCircle className="login-submit-spinner" size={18} strokeWidth={2.2} />
                    <span>{isEn ? 'Signing in...' : 'Connexion...'}</span>
                  </>
                ) : (
                  isEn ? 'Log in' : 'Se connecter'
                )}
              </button>

              {message ? <p className="form-error">{message}</p> : null}

              {needsVerificationResend ? (
                <>
                  <button
                    type="button"
                    className="btn-secondary wide"
                    onClick={onResendVerification}
                    disabled={resendStatus === 'sending'}
                  >
                    {resendStatus === 'sending' ? (isEn ? 'Sending...' : 'Envoi...') : (isEn ? 'Resend verification link' : 'Renvoyer le lien de verification')}
                  </button>
                  {resendStatus !== 'idle' ? (
                    <p className={resendStatus === 'error' ? 'form-error' : 'form-help'}>{resendMessage}</p>
                  ) : null}
                </>
              ) : null}
            </form>
          </div>
        </AuthCard>
      </div>
    </main>
  );
}

