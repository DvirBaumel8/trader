import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api/client';
import { Logo } from './Logo';

type Health = { status: string; database: string; userId: string | null };

/**
 * Silent when healthy, loud when broken. A permanent "everything is fine"
 * badge is noise the user learns to ignore; a bar that only appears on failure
 * is information.
 */
function ConnectionBanner() {
  const { data, isError, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health'),
    refetchInterval: 30_000,
  });

  if (isLoading) return null;
  if (!isError && data?.status === 'ok') return null;

  return (
    <div className="bg-down/15 px-4 py-2 text-center text-xs text-down">
      Can’t reach the server
    </div>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-3 py-2.5 text-sm transition-colors ${
    isActive
      ? 'border-accent text-text'
      : 'border-transparent text-muted hover:text-text'
  }`;

export function AppShell() {
  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col">
      <header className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <Logo className="h-6 w-6" />
        <span className="text-[19px] font-semibold tracking-tight">Trader</span>
      </header>

      <ConnectionBanner />

      {/*
        Only real destinations belong here. The dev-only ticker probe is
        deliberately absent and reachable by typing /probe — scaffolding should
        not take up space in the product's navigation.
      */}
      <nav className="flex border-b border-border px-2">
        <NavLink to="/" className={linkClass} end>
          Portfolio
        </NavLink>
        <NavLink to="/stops" className={linkClass}>
          Stops
        </NavLink>
        <NavLink to="/journal" className={linkClass}>
          Journal
        </NavLink>
      </nav>

      <main className="flex-1 px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
