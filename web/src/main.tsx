import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App, { router } from './App';
import { auth } from './api/client';
import { installLongPress } from './lib/mobile';
import { endSession } from './lib/session';
import { queryClient } from './lib/queryClient';
import './index.css';

auth.onUnauthorized(() => {
  endSession();
  void router.navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`, { replace: true });
});

installLongPress();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
