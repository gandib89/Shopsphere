import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

export const renderRoute = (ui: ReactElement, path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      {ui}
    </MemoryRouter>,
  );
