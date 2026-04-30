import { createBrowserRouter } from 'react-router';
import { CheckoutPage } from './pages/CheckoutPage';

export const router = createBrowserRouter([
  { path: '/', Component: CheckoutPage },
  { path: '/checkout', Component: CheckoutPage },
]);
