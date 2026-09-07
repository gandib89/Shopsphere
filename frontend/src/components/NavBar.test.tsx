import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it } from 'vitest';
import NavBar from './NavBar';

beforeEach(() => localStorage.clear());

it('moves keyboard focus beyond customer navigation', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><NavBar /><main><h1>Page content</h1></main></MemoryRouter>);

  const skipLink = screen.getByRole('link', { name: 'Skip to content' });
  await user.click(skipLink);

  expect(document.getElementById('customer-content')).toHaveFocus();
});
