// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Login } from './Login';
import { stubLocalStorage } from '../test/memoryLocalStorage';
import { rememberUser } from '../lib/auth';

vi.mock('../api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../api/client';

beforeEach(() => {
  vi.clearAllMocks();
  stubLocalStorage();
  (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path === '/auth/config') return Promise.resolve({ google: false });
    return Promise.resolve({
      accessToken: 't',
      user: { id: 'u1', displayName: 'Dvir', email: 'd@x.com', avatarUrl: null },
    });
  });
});
afterEach(cleanup);

const renderLogin = () =>
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );

describe('Login', () => {
  /**
   * The owner's account predates accounts entirely — no email, no password of
   * its own. If the shared-password form stops being the default on a device
   * that has never signed anyone in, a deploy locks him out of his own
   * portfolio.
   */
  it('defaults to the app password when nobody has signed in here', () => {
    renderLogin();
    expect(screen.queryByPlaceholderText('Email')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
  });

  it('sends the app password to the original endpoint', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => {
      const call = (api as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === '/auth/login',
      );
      expect(call).toBeDefined();
    });
  });

  it('greets someone it has seen before and offers their email', () => {
    rememberUser({ id: 'u1', displayName: 'Dvir', email: 'd@x.com', avatarUrl: null });
    renderLogin();
    expect(screen.getByText(/Welcome back/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email')).toHaveValue('d@x.com');
  });

  it('lets a returning user say it is not them', async () => {
    const user = userEvent.setup();
    rememberUser({ id: 'u1', displayName: 'Dvir', email: 'd@x.com', avatarUrl: null });
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Not you?' }));
    expect(screen.queryByText(/Welcome back/)).not.toBeInTheDocument();
  });

  it('can create an account instead', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: /Create an account/ }));
    await user.type(screen.getByPlaceholderText('Email'), 'new@x.com');
    await user.type(screen.getByPlaceholderText(/8\+ characters/), 'longenough1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      const call = (api as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === '/auth/signup',
      );
      expect(call).toBeDefined();
    });
  });

  /** No client id on the server means the button would be a dead end. */
  /**
   * A branch preview points at the production API, which may predate this
   * build and return only a token. Signing in must still work.
   */
  it('signs in against an API that returns no user', async () => {
    const user = userEvent.setup();
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === '/auth/config') return Promise.reject(new Error('404'));
      return Promise.resolve({ accessToken: 't' });
    });
    renderLogin();
    await user.type(screen.getByPlaceholderText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => {
      expect(
        (api as ReturnType<typeof vi.fn>).mock.calls.some((c) => c[0] === '/auth/login'),
      ).toBe(true);
    });
    expect(screen.queryByText(/Could not/)).not.toBeInTheDocument();
  });

  it('offers Google only where the server says it is configured', async () => {
    renderLogin();
    await waitFor(() => {
      expect(document.getElementById('google-button')).toBeNull();
    });
  });
});
