import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Button } from '../components/ui/Button';
import { inputClasses } from '../components/ui/inputClasses';
import {
  forgetUser,
  getRememberedUser,
  rememberUser,
  setToken,
  type RememberedUser,
} from '../lib/auth';

const inputClass = `${inputClasses('md')} rounded-xl px-4 py-3`;

interface Session {
  accessToken: string;
  user: RememberedUser;
}

type Mode = 'SIGN_IN' | 'SIGN_UP' | 'APP_PASSWORD';

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return (err as { message?: string }).message || fallback;
  }
  return 'Could not reach the server';
}

export function Login() {
  const navigate = useNavigate();
  const remembered = getRememberedUser();

  /**
   * A returning person lands on sign-in with their email already filled.
   * The owner's own account predates accounts entirely and has no email, so
   * the shared-password form stays reachable and is the default whenever
   * nobody has been remembered on this device — taking that away would lock
   * him out of his own portfolio.
   */
  const [mode, setMode] = useState<Mode>(
    remembered?.email ? 'SIGN_IN' : 'APP_PASSWORD',
  );
  const [email, setEmail] = useState(remembered?.email ?? '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);

  // Google is only offered where the server says it is configured — without
  // GOOGLE_CLIENT_ID the button would be a dead end.
  useEffect(() => {
    let cancelled = false;
    api<{ google: boolean }>('/auth/config')
      .then((c) => {
        if (!cancelled) setGoogleAvailable(c.google);
      })
      .catch(() => {
        // An unreachable server is reported by the sign-in attempt itself;
        // silently leaving the button hidden is the honest default.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function accept(session: Session) {
    setToken(session.accessToken);
    rememberUser(session.user);
    navigate('/', { replace: true });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'APP_PASSWORD') {
        accept(
          await api<Session>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ password }),
          }),
        );
      } else if (mode === 'SIGN_IN') {
        accept(
          await api<Session>('/auth/signin', {
            method: 'POST',
            body: JSON.stringify({ email: email.trim(), password }),
          }),
        );
      } else {
        accept(
          await api<Session>('/auth/signup', {
            method: 'POST',
            body: JSON.stringify({
              email: email.trim(),
              password,
              ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
            }),
          }),
        );
      }
    } catch (err) {
      setError(
        messageFor(
          err,
          mode === 'SIGN_UP' ? 'Could not create that account' : 'Wrong details',
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const needsEmail = mode !== 'APP_PASSWORD';

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center px-6">
      <h1 className="mb-2 text-center text-lg font-semibold text-text">Trader</h1>

      {remembered && (
        <div className="mb-5 flex flex-col items-center gap-1">
          {remembered.avatarUrl && (
            <img
              src={remembered.avatarUrl}
              alt=""
              className="h-10 w-10 rounded-full"
            />
          )}
          <p className="text-sm text-muted">
            Welcome back, <span className="text-text">{remembered.displayName}</span>
          </p>
          <button
            type="button"
            onClick={() => {
              forgetUser();
              setEmail('');
              setMode('SIGN_IN');
            }}
            className="text-[11px] text-muted underline underline-offset-4"
          >
            Not you?
          </button>
        </div>
      )}

      <form onSubmit={submit} className="space-y-3">
        {needsEmail && (
          <input
            type="email"
            autoComplete="email"
            autoFocus={!remembered}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className={inputClass}
          />
        )}
        {mode === 'SIGN_UP' && (
          <input
            type="text"
            autoComplete="nickname"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Name (optional)"
            className={inputClass}
          />
        )}
        <input
          type="password"
          autoFocus={Boolean(remembered) || mode === 'APP_PASSWORD'}
          autoComplete={mode === 'SIGN_UP' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === 'SIGN_UP' ? 'Password (8+ characters)' : 'Password'}
          className={inputClass}
        />
        {error && <p className="text-sm text-down">{error}</p>}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full rounded-xl"
          disabled={
            submitting ||
            password.length === 0 ||
            (needsEmail && email.trim().length === 0)
          }
        >
          {submitting
            ? 'Checking…'
            : mode === 'SIGN_UP'
              ? 'Create account'
              : 'Log in'}
        </Button>
      </form>

      {googleAvailable && (
        <GoogleButton onSession={accept} onError={setError} />
      )}

      <div className="mt-5 flex flex-col items-center gap-2 text-xs text-muted">
        {mode === 'SIGN_UP' ? (
          <button type="button" onClick={() => setMode('SIGN_IN')} className="underline underline-offset-4">
            Already have an account? Sign in
          </button>
        ) : (
          <button type="button" onClick={() => setMode('SIGN_UP')} className="underline underline-offset-4">
            New here? Create an account
          </button>
        )}
        {mode === 'APP_PASSWORD' ? (
          <button type="button" onClick={() => setMode('SIGN_IN')} className="underline underline-offset-4">
            Sign in with an email instead
          </button>
        ) : (
          <button type="button" onClick={() => setMode('APP_PASSWORD')} className="underline underline-offset-4">
            Use the app password
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Google Identity Services, loaded only where it is configured.
 *
 * The script is injected rather than put in index.html so a deployment
 * without Google sign-in never fetches it at all — and so the CSP surface of
 * the normal app is unchanged for everyone who does not use it.
 */
function GoogleButton({
  onSession,
  onError,
}: {
  onSession: (session: Session) => void;
  onError: (message: string) => void;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const existing = document.getElementById('gsi-script');
    if (existing) {
      setReady(true);
      return;
    }
    const script = document.createElement('script');
    script.id = 'gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => setReady(true);
    script.onerror = () => onError('Could not load Google sign-in');
    document.head.appendChild(script);
  }, [onError]);

  useEffect(() => {
    if (!ready) return;
    const google = (window as unknown as { google?: GoogleAccounts }).google;
    const target = document.getElementById('google-button');
    if (!google || !target) return;

    google.accounts.id.initialize({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
      callback: (response: { credential: string }) => {
        api<Session>('/auth/google', {
          method: 'POST',
          body: JSON.stringify({ idToken: response.credential }),
        })
          .then(onSession)
          .catch((err) => onError(messageFor(err, 'Google sign-in failed')));
      },
    });
    google.accounts.id.renderButton(target, {
      theme: 'filled_black',
      size: 'large',
      width: 320,
    });
  }, [ready, onSession, onError]);

  return (
    <div className="mt-4 flex justify-center">
      <div id="google-button" />
    </div>
  );
}

interface GoogleAccounts {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: { credential: string }) => void;
      }) => void;
      renderButton: (
        target: HTMLElement,
        options: { theme: string; size: string; width: number },
      ) => void;
    };
  };
}
