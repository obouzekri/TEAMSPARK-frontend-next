"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from './Logo';
import LanguageSwitcher from './LanguageSwitcher';
import NavItem from './NavItem';
import AvatarMenu from './AvatarMenu';
import useI18n from '@/lib/i18n/useI18n';
import { stripLocaleFromPath } from '@/lib/i18n/routing';
import useBodyScrollLock from '@/lib/useBodyScrollLock';
import { resolveUserAvatar } from '@/lib/avatar-profile';

export default function AppNav({ userLabel, onLogout, role, avatarUrl: avatarUrlProp = '', avatarInitials: avatarInitialsProp = '' }) {
  const pathname = usePathname();
  const plainPathname = stripLocaleFromPath(pathname || '/');
  const [activeHomeBlock, setActiveHomeBlock] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { t, withLocalePath } = useI18n();

  const isParticipant = role === 'participant';
  const isAdmin = role === 'admin';
  const isParticipantChallengeLive = isParticipant && plainPathname?.startsWith('/challenges/');
  const isCompact = role === 'participant-live' || isParticipantChallengeLive;
  const isManager = !isParticipant && !isAdmin && !isCompact;
  const isParticipantArea = isParticipant && !isCompact;
  const showHeaderLanguageSwitcher = !isManager && !isParticipantArea && !isCompact;
  const brandHref = isParticipant && !isCompact ? '/participant' : isAdmin ? '/admin' : '/home';
  const headerClassName = isCompact ? 'top-nav top-nav--live-inline' : 'top-nav';
  const isManagerHome = isManager && plainPathname === '/home';
  const isActive = (href) => plainPathname?.startsWith(href);
  const contextLabel = isParticipant
    ? ''
    : isAdmin
      ? ''
      : isCompact
        ? t('appNav.liveSession')
        : t('appNav.managerSpace');
  const navPanelClassName = `nav-panel${(isManager || isParticipantArea) ? ' nav-panel--manager' : ''}${isMenuOpen ? ' is-open' : ''}`;
  const resolvedUserLabel = userLabel || (isParticipant ? t('appNav.participant') : t('appNav.manager'));
  const accountHref = isParticipant ? '/account?tab=security' : '/account';
  const homeHref = isParticipant ? '/participant' : isAdmin ? '/admin' : '/home';
  const roleLabel = isParticipant ? t('appNav.participant') : isAdmin ? t('appNav.admin') : t('appNav.manager');
  const [sessionUser, setSessionUser] = useState(null);
  const canUseMobileDrawer = !isCompact;
  const menuSignal = `${pathname}:${isMenuOpen ? 'open' : 'closed'}`;

  useBodyScrollLock(isMenuOpen && canUseMobileDrawer);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem('currentUser');
      const parsed = raw ? JSON.parse(raw) : null;
      setSessionUser(parsed || null);
    } catch {
      setSessionUser(null);
    }
  }, [pathname]);

  const userInitials = resolvedUserLabel
    .split(' ')
    .map((part) => String(part || '').trim().slice(0, 1).toUpperCase())
    .filter(Boolean)
    .slice(0, 2)
    .join('') || 'U';

  const resolvedAvatar = resolveUserAvatar(sessionUser, resolvedUserLabel);
  const computedAvatarUrl = String(avatarUrlProp || resolvedAvatar.avatarUrl || '').trim();
  const computedAvatarInitials = String(avatarInitialsProp || resolvedAvatar.avatarInitials || userInitials).trim() || userInitials;

  useEffect(() => {
    if (!isMenuOpen || !canUseMobileDrawer) return undefined;
    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isMenuOpen, canUseMobileDrawer]);

  // Close dropdown and mobile menu on navigation
  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isManagerHome) {
      setActiveHomeBlock('');
      return undefined;
    }

    const sessionsEl = document.getElementById('home-sessions-block');
    const participantsEl = document.getElementById('home-participants-block');
    if (!sessionsEl || !participantsEl) return undefined;

    const computeActive = () => {
      const sessionsTop = Math.abs(sessionsEl.getBoundingClientRect().top - 120);
      const participantsTop = Math.abs(participantsEl.getBoundingClientRect().top - 120);
      setActiveHomeBlock(sessionsTop <= participantsTop ? 'sessions' : 'participants');
    };

    computeActive();

    const observer = new IntersectionObserver(
      () => { computeActive(); },
      { root: null, rootMargin: '-35% 0px -45% 0px', threshold: [0.1, 0.35, 0.6] }
    );

    observer.observe(sessionsEl);
    observer.observe(participantsEl);

    return () => { observer.disconnect(); };
  }, [isManagerHome]);

  function scrollToHomeBlock(event, blockId, blockKey) {
    if (!isManagerHome) return;
    event.preventDefault();
    const target = document.getElementById(blockId);
    if (!target) return;
    setActiveHomeBlock(blockKey);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.history.replaceState(null, '', withLocalePath(`/home#${blockKey}`));
  }

  const desktopAvatarItems = [
    {
      key: 'home',
      label: t('appNav.home'),
      href: withLocalePath(homeHref),
    },
    {
      key: 'account',
      label: t('nav.myAccount'),
      href: withLocalePath(accountHref),
    },
    {
      key: 'preferences',
      label: t('appNav.preferences'),
      href: withLocalePath('/preferences'),
    },
    {
      key: 'separator-logout',
      type: 'separator',
    },
    {
      key: 'logout',
      label: t('appNav.logout'),
      danger: true,
      onClick: () => onLogout?.(),
    },
  ];

  return (
    <>
      <header className={headerClassName}>
        <div className={`shell nav-inner${isCompact ? ' nav-inner--live-inline' : ''}`}>
          <div className="nav-top-row">
            <div className="nav-brand-block">
              <Link href={withLocalePath(brandHref)} className="brand">
                <Logo size="default" />
              </Link>
              {!isManager && !isCompact && contextLabel ? <span className="nav-context">{contextLabel}</span> : null}
            </div>

            {!isCompact ? (
              <button
                type="button"
                className={`nav-toggle ${isMenuOpen ? 'is-open' : ''}`}
                aria-expanded={isMenuOpen}
                aria-controls="app-nav-panel"
                aria-label={isMenuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
                onClick={() => setIsMenuOpen((current) => !current)}
              >
                <span className="nav-toggle__line" />
                <span className="nav-toggle__line" />
                <span className="nav-toggle__line" />
              </button>
            ) : null}
          </div>

          <div id="app-nav-panel" className={`${navPanelClassName}${isCompact ? ' nav-panel--live-inline' : ''}`}>
            {isParticipant && !isCompact && (
              <div className="nav-main-block">
                <nav className="nav-links appnav-mobile-main-links" aria-label="Navigation participant">
                  <NavItem
                    href={withLocalePath('/participant')}
                    onClick={() => setIsMenuOpen(false)}
                    active={isActive('/participant')}
                  >
                    {t('appNav.mySessions')}
                  </NavItem>
                  <NavItem
                    href={withLocalePath('/account?tab=security')}
                    onClick={() => setIsMenuOpen(false)}
                    active={isActive('/account')}
                  >
                    {t('nav.myAccount')}
                  </NavItem>
                </nav>
              </div>
            )}

            {!isParticipant && !isCompact && !isAdmin && (
              <div className="nav-main-block">
                <nav className="nav-links appnav-mobile-main-links appnav-mobile-main-links--desktop-menu" aria-label="Navigation manager">
                  <NavItem
                    href={withLocalePath('/home')}
                    active={isManagerHome}
                    onClick={() => {
                      setIsMenuOpen(false);
                    }}
                  >
                    {t('appNav.home')}
                  </NavItem>
                  <NavItem
                    href={withLocalePath('/account')}
                    active={isActive('/account')}
                    onClick={() => {
                      setIsMenuOpen(false);
                    }}
                  >
                    {t('nav.myAccount')}
                  </NavItem>
                  <NavItem
                    href={withLocalePath('/preferences')}
                    active={isActive('/preferences')}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {t('appNav.preferences')}
                  </NavItem>
                  <button
                    type="button"
                    className="nav-link nav-link--logout"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onLogout?.();
                    }}
                  >
                    {t('appNav.logout')}
                  </button>
                </nav>
              </div>
            )}

            {isAdmin && !isCompact && (
              <div className="nav-main-block">
                <nav className="nav-links appnav-mobile-main-links" aria-label="Navigation admin">
                  <NavItem
                    href={withLocalePath('/admin')}
                    active={isActive('/admin')}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {t('appNav.backToAdmin')}
                  </NavItem>
                </nav>
              </div>
            )}

            {!isCompact && !isManager ? (
              <div className="nav-mobile-menu-actions appnav-mobile-actions" aria-label={t('nav.accountAria')}>
                <button
                  type="button"
                  className="btn-mini appnav-mobile-logout-btn"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onLogout?.();
                  }}
                >
                  {t('appNav.logout')}
                </button>
                {showHeaderLanguageSwitcher ? <LanguageSwitcher /> : null}
              </div>
            ) : null}

            <div className="nav-actions appnav-desktop-actions" aria-label={t('nav.accountAria')}>
              {showHeaderLanguageSwitcher ? <LanguageSwitcher /> : null}
              <AvatarMenu
                userLabel={resolvedUserLabel}
                roleLabel={roleLabel}
                avatarUrl={computedAvatarUrl}
                avatarInitials={computedAvatarInitials}
                triggerLabel={t('appNav.userMenuOf', { name: resolvedUserLabel })}
                menuLabel={t('appNav.userMenu')}
                closeSignal={menuSignal}
                items={desktopAvatarItems}
              />
            </div>
          </div>
        </div>
      </header>

      {isMenuOpen && canUseMobileDrawer ? (
        <button
          type="button"
          className="nav-mobile-overlay"
          aria-label={t('nav.closeMenu')}
          onClick={() => setIsMenuOpen(false)}
        />
      ) : null}
    </>
  );
}

