import { createBrowserRouter } from 'react-router';
import { EventPage } from './pages/EventPage';
import { CheckoutPage } from './pages/CheckoutPage';

export const router = createBrowserRouter([
  { path: '/', Component: EventPage },
  { path: '/checkout', Component: CheckoutPage },
]);
