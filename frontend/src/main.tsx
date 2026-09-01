import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RestoreLocation } from './components/RestoreLocation';
import { Dashboard } from './routes/Dashboard';
import { TickerProbe } from './routes/TickerProbe';
import { Seed } from './routes/Seed';
import { Journal } from './routes/Journal';
import { Login } from './routes/Login';
import { TradeDetail } from './routes/TradeDetail';
import './index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RestoreLocation />
        <Routes>
          <Route path="login" element={<Login />} />
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="journal" element={<Journal />} />
            <Route path="trades/:id" element={<TradeDetail />} />
            <Route path="seed" element={<Seed />} />
            <Route path="probe" element={<TickerProbe />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
