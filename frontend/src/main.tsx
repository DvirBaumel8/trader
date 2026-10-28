import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RestoreLocation } from './components/RestoreLocation';
import { RestoreScroll } from './components/RestoreScroll';
import { Chat } from './routes/Chat';
import { Holdings } from './routes/Holdings';
import { Watchlist } from './routes/Watchlist';
import { Login } from './routes/Login';
import './index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RestoreLocation />
        <RestoreScroll />
        <Routes>
          <Route path="login" element={<Login />} />
          <Route element={<AppShell />}>
            <Route index element={<Chat />} />
            <Route path="holdings" element={<Holdings />} />
            <Route path="watchlist" element={<Watchlist />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
