import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderRoute } from '../../test/render';
import { RoleSelector } from './RoleSelector';

describe('role selector', () => {
  it('changes role through semantic radio controls', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderRoute(<RoleSelector value="user" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: /^Seller\b/i }));
    expect(onChange).toHaveBeenCalledWith('seller');
  });
});
