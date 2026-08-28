import { fireEvent, render, screen } from '@testing-library/react';
import { Package } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { ActionList } from './ActionList';
import { PageHeader } from './PageHeader';

describe('operations primitives', () => {
  it('gives an operations page one clear title and optional action', () => {
    const onRefresh = vi.fn();

    render(
      <PageHeader
        eyebrow="Administration"
        title="Marketplace operations"
        description="Manage the work that needs attention."
        action={<button onClick={onRefresh}>Refresh data</button>}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Marketplace operations' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('renders actions as one readable list with counts', () => {
    const onSelect = vi.fn();

    render(
      <ActionList
        label="Workspaces"
        items={[
          {
            key: 'products',
            icon: <Package />,
            title: 'All products',
            description: 'Manage marketplace inventory',
            count: 12,
            onSelect,
          },
        ]}
      />,
    );

    expect(screen.getByRole('list', { name: 'Workspaces' })).toBeInTheDocument();
    expect(screen.getByText('12')).toHaveAccessibleName('12 items');
    fireEvent.click(screen.getByRole('button', { name: /all products/i }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
