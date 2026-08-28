import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api/client';

type Health = { status: string; database: string; userId: string | null };

function HealthDot() {
  const { data, isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health'),
    refetchInterval: 30_000,
  });
  const ok = !isError && data?.status === 'ok';
  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <span
        className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-up' : 'bg-down'}`}
      />
      {ok ? 'connected' : 'offline'}
    </span>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 text-sm ${isActive ? 'text-text' : 'text-muted'}`;

export function AppShell() {
  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold tracking-wide">TRADER</span>
        <HealthDot />
      </header>
      <nav className="flex border-b border-border px-2">
        <NavLink to="/" className={linkClass} end>
          Portfolio
        </NavLink>
        <NavLink to="/probe" className={linkClass}>
          Probe
        </NavLink>
      </nav>
      <main className="flex-1 px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
