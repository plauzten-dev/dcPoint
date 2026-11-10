import { lazy, Suspense } from 'react';
import { createBrowserRouter, createHashRouter, Navigate, RouterProvider } from 'react-router';
import { auth } from './api/client';
import AppShell, { GuildView, HomeView } from './components/AppShell';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const InvitePage = lazy(() => import('./pages/InvitePage'));

const isTauri = '__TAURI_INTERNALS__' in window;
const createRouter = isTauri ? createHashRouter : createBrowserRouter;

export const router = createRouter([
  { path: '/', element: <Navigate to={auth.token ? '/channels/@me' : '/login'} replace /> },
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  { path: '/invite/:code', element: <InvitePage /> },
  {
    path: '/channels',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/channels/@me" replace /> },
      { path: '@me', element: <HomeView /> },
      { path: ':guildId/:channelId?', element: <GuildView /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default function App() {
  return (
    <Suspense fallback={<div className="h-full bg-chat" />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
