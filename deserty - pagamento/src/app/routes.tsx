import { createBrowserRouter } from 'react-router';
import { CheckoutPage } from './pages/CheckoutPage';
import { OAuthCallbackPage } from './pages/OAuthCallbackPage';

export const router = createBrowserRouter([
  { path: '/', Component: CheckoutPage },
  { path: '/checkout', Component: CheckoutPage },
  { path: '/oauth-callback', Component: OAuthCallbackPage },
]);
