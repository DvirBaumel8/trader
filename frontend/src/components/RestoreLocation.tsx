import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { loadUiState, saveUiState } from '../lib/uiState';

const LOGIN_PATH = '/login';

/**
 * Puts the user back on the screen they left.
 *
 * Installed to the home screen the app cold-starts at `start_url` every time
 * iOS reclaims it, so switching to a broker app and back would otherwise
 * always land on Portfolio — regardless of what you were doing.
 *
 * Only redirects away from "/", and only once on mount, so it can never
 * hijack a deliberate navigation.
 */
export function RestoreLocation() {
  const navigate = useNavigate();
  const location = useLocation();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    const saved = loadUiState();
    if (!saved) return;
    if (location.pathname !== '/') return;
    if (saved.path === '/') return;
    // Never restore to the sign-in screen. It is not a place he was working,
    // and sending a signed-in user back to a password form is the opposite of
    // putting him where he left off.
    if (saved.path === LOGIN_PATH) return;

    navigate(saved.path, { replace: true });
  }, [navigate, location.pathname]);

  // Keep the remembered path current as the user moves around, so a discard
  // at any moment restores to the right screen.
  useEffect(() => {
    // The sign-in screen is never somewhere to come back to, so it is not
    // recorded either — belt to the braces above, and it keeps a stale
    // '/login' out of storage for anyone who already has one.
    if (location.pathname === LOGIN_PATH) return;

    const saved = loadUiState();
    saveUiState({
      path: location.pathname,
      journalTab: saved?.journalTab ?? 'ACTIVITIES',
      editingEntryId: saved?.editingEntryId ?? null,
      composing: saved?.composing ?? false,
    });
  }, [location.pathname]);

  return null;
}
