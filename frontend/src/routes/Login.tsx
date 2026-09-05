import { Button } from '../components/ui/Button';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { setToken } from '../lib/auth';

export function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { accessToken } = await api<{ accessToken: string }>(
        '/auth/login',
        { method: 'POST', body: JSON.stringify({ password }) },
      );
      setToken(accessToken);
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Wrong password'
          : 'Could not reach the server',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center px-6">
      <h1 className="mb-6 text-center text-lg font-semibold text-text">
        Trader
      </h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-xl border border-border bg-surface-1 px-4 py-3 text-text"
        />
        {error && <p className="text-sm text-down">{error}</p>}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full rounded-xl"
          disabled={submitting || password.length === 0}
        >
          {submitting ? 'Checking…' : 'Log in'}
        </Button>
      </form>
    </div>
  );
}
