import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '../../test/render';
import { Button, IconButton } from './Button';
import { Field } from './Field';
import { EmptyState } from './AsyncState';

describe('ShopSphere UI primitives', () => {
  it('keeps a loading button named and unavailable', () => {
    renderRoute(<Button loading>Save changes</Button>);

    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('requires an accessible label for icon-only actions', () => {
    renderRoute(<IconButton label="Open menu">≡</IconButton>);

    expect(screen.getByRole('button', { name: 'Open menu' })).toBeVisible();
  });

  it('connects field labels and errors to their controls', () => {
    renderRoute(
      <Field
        label="Email"
        name="email"
        type="email"
        error="Enter a valid email"
      />,
    );

    const input = screen.getByLabelText('Email');
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription('Enter a valid email');
  });

  it('gives empty states a heading and recovery action', () => {
    renderRoute(
      <EmptyState
        title="No products yet"
        description="Try a different category."
        action={<Button>View all products</Button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'No products yet' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'View all products' })).toBeVisible();
  });
});
