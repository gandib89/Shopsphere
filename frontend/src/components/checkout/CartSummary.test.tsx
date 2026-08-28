import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CartSummary } from './CartSummary';

describe('CartSummary', () => {
  it('shows a clear payable total and advances to checkout', () => {
    const onCheckout = vi.fn();

    render(<CartSummary itemCount={3} subtotal={245000} onCheckout={onCheckout} />);

    expect(screen.getAllByText('Rs. 245,000')).toHaveLength(2);
    expect(screen.getByText('Free')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Proceed to checkout' }));
    expect(onCheckout).toHaveBeenCalledOnce();
  });
});
