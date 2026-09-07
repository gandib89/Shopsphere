import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute';

function CurrentLocation() {
  const location = useLocation();
  return <p>{location.pathname}</p>;
}

const renderCustomerRoute = () => render(
  <MemoryRouter initialEntries={['/profile?tab=security']}>
    <Routes>
      <Route element={<ProtectedRoute role="customer" />}>
        <Route path="/profile" element={<p>Customer profile</p>} />
      </Route>
      <Route path="/auth" element={<CurrentLocation />} />
      <Route path="/admin" element={<CurrentLocation />} />
      <Route path="/seller-panel" element={<CurrentLocation />} />
    </Routes>
  </MemoryRouter>,
);

describe('customer route protection', () => {
  beforeEach(() => localStorage.clear());

  it('redirects signed-out visitors to authentication', () => {
    renderCustomerRoute();
    expect(screen.getByText('/auth')).toBeVisible();
  });

  it('renders customer pages for a customer session', () => {
    localStorage.setItem('token', 'session');
    renderCustomerRoute();
    expect(screen.getByText('Customer profile')).toBeVisible();
  });

  it('returns admin and seller sessions to their own workspaces', () => {
    localStorage.setItem('token', 'session');
    localStorage.setItem('isAdmin', 'true');
    const { unmount } = renderCustomerRoute();
    expect(screen.getByText('/admin')).toBeVisible();

    unmount();
    localStorage.setItem('isAdmin', 'false');
    localStorage.setItem('isSeller', 'true');
    renderCustomerRoute();
    expect(screen.getByText('/seller-panel')).toBeVisible();
  });
});
