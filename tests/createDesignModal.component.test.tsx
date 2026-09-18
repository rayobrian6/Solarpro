/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';

import {
  CreateDesignModal,
  DEFAULT_COST_PER_WATT,
  readDesigns,
  __resetDesignsForTesting,
  type Design,
} from '@/components/3d/designs';

// ── In-memory localStorage shim for jsdom (vitest 4 + jsdom 29
//    don't enable localStorage by default)
interface MemStore {
  data: Record<string, string>;
}

function installLocalStorageShim(store: MemStore = { data: {} }) {
  const ls = {
    getItem: (key: string) => (key in store.data ? store.data[key] : null),
    setItem: (key: string, value: string) => {
      store.data[key] = value;
    },
    removeItem: (key: string) => {
      delete store.data[key];
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).localStorage = ls;
  return store;
}

function uninstallLocalStorageShim() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).localStorage;
}

beforeEach(() => {
  installLocalStorageShim();
  __resetDesignsForTesting();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  uninstallLocalStorageShim();
  __resetDesignsForTesting();
});

function makeDesign(overrides: Partial<Design> = {}): Design {
  return {
    id: 'd-1',
    projectId: 'p-1',
    name: 'Design 1',
    costPerWatt: 4,
    createdAt: '2026-08-26T00:00:00.000Z',
    active: true,
    ...overrides,
  };
}

function renderModal(
  overrides: Partial<React.ComponentProps<typeof CreateDesignModal>> = {},
) {
  const onClose = vi.fn();
  const onCreate = vi.fn();
  const props: React.ComponentProps<typeof CreateDesignModal> = {
    open: true,
    onClose,
    onCreate,
    projectId: 'p-1',
    existingDesigns: [],
    ...overrides,
  };
  const result = render(<CreateDesignModal {...props} />);
  return { ...result, onClose, onCreate, props };
}

describe('<CreateDesignModal />', () => {
  it('renders nothing when open={false}', () => {
    render(
      <CreateDesignModal
        open={false}
        onClose={() => {}}
        onCreate={() => {}}
        projectId="p-1"
      />,
    );
    expect(screen.queryByTestId('create-design-modal')).not.toBeInTheDocument();
    expect(screen.queryByText(/create design/i)).not.toBeInTheDocument();
  });

  it('renders the title, both fields, and both buttons when open', () => {
    renderModal();
    expect(screen.getByTestId('create-design-modal')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /create design/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cost \$?\/w/i)).toBeInTheDocument();
    expect(screen.getByTestId('create-design-cancel')).toBeInTheDocument();
    expect(screen.getByTestId('create-design-submit')).toBeInTheDocument();
  });

  it('defaults name to "Design 1" when no existing designs', () => {
    renderModal();
    const nameInput = screen.getByTestId('create-design-name-input') as HTMLInputElement;
    expect(nameInput.value).toBe('Design 1');
  });

  it('defaults name to "Design N+1" when N existing designs pass in', () => {
    renderModal({
      existingDesigns: [
        makeDesign({ id: 'a', name: 'Design 1' }),
        makeDesign({ id: 'b', name: 'Design 2' }),
      ],
    });
    const nameInput = screen.getByTestId('create-design-name-input') as HTMLInputElement;
    expect(nameInput.value).toBe('Design 3');
  });

  it('defaults cost to 4.00', () => {
    renderModal();
    const costInput = screen.getByTestId('create-design-cost-input') as HTMLInputElement;
    expect(costInput.value).toBe('4');
    expect(DEFAULT_COST_PER_WATT).toBe(4);
  });

  it('disables the Create button when the name is empty', () => {
    renderModal();
    const nameInput = screen.getByTestId('create-design-name-input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });
    const submit = screen.getByTestId('create-design-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('disables the Create button when the cost is 0 or negative', () => {
    renderModal();
    const costInput = screen.getByTestId('create-design-cost-input') as HTMLInputElement;
    fireEvent.change(costInput, { target: { value: '0' } });
    expect((screen.getByTestId('create-design-submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(costInput, { target: { value: '-1' } });
    expect((screen.getByTestId('create-design-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('valid submit persists a Design and calls onCreate + onClose', async () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateDesignModal
        open
        onClose={onClose}
        onCreate={onCreate}
        projectId="p-1"
        existingDesigns={[]}
      />,
    );

    fireEvent.click(screen.getByTestId('create-design-submit'));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    const design = onCreate.mock.calls[0][0] as Design;
    expect(design.projectId).toBe('p-1');
    expect(design.name).toBe('Design 1');
    expect(design.costPerWatt).toBe(4);
    expect(design.active).toBe(true);
    expect(typeof design.id).toBe('string');
    expect(design.id.length).toBeGreaterThan(0);
    expect(() => new Date(design.createdAt).toISOString()).not.toThrow();

    expect(readDesigns()).toHaveLength(1);
    expect(readDesigns()[0].id).toBe(design.id);
  });

  it('submits custom name and cost and they are reflected in the payload', () => {
    const onCreate = vi.fn();
    render(
      <CreateDesignModal
        open
        onClose={() => {}}
        onCreate={onCreate}
        projectId="p-1"
        existingDesigns={[]}
      />,
    );
    fireEvent.change(screen.getByTestId('create-design-name-input'), {
      target: { value: 'My Custom Roof' },
    });
    fireEvent.change(screen.getByTestId('create-design-cost-input'), {
      target: { value: '5.25' },
    });
    fireEvent.click(screen.getByTestId('create-design-submit'));

    const design = onCreate.mock.calls[0][0] as Design;
    expect(design.name).toBe('My Custom Roof');
    expect(design.costPerWatt).toBe(5.25);
  });

  it('trims whitespace from the name on submit', () => {
    const onCreate = vi.fn();
    render(
      <CreateDesignModal
        open
        onClose={() => {}}
        onCreate={onCreate}
        projectId="p-1"
        existingDesigns={[]}
      />,
    );
    fireEvent.change(screen.getByTestId('create-design-name-input'), {
      target: { value: '  Padded Name  ' },
    });
    fireEvent.click(screen.getByTestId('create-design-submit'));
    expect((onCreate.mock.calls[0][0] as Design).name).toBe('Padded Name');
  });

  it('does not call onCreate when Cancel is clicked', () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateDesignModal
        open
        onClose={onClose}
        onCreate={onCreate}
        projectId="p-1"
        existingDesigns={[]}
      />,
    );
    fireEvent.click(screen.getByTestId('create-design-cancel'));
    expect(onCreate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(readDesigns()).toHaveLength(0);
  });

  it('backdrop click calls onClose (and not onCreate)', () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateDesignModal
        open
        onClose={onClose}
        onCreate={onCreate}
        projectId="p-1"
        existingDesigns={[]}
      />,
    );
    const backdrop = screen.getByTestId('create-design-modal');
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('clicking inside the modal does NOT close it (mousedown bubbling guard)', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const card = screen.getByTestId('create-design-modal-card');
    fireEvent.mouseDown(card);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape key calls onClose', () => {
    const onClose = vi.fn();
    render(
      <CreateDesignModal
        open
        onClose={onClose}
        onCreate={() => {}}
        projectId="p-1"
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('re-opens with the default values (does not leak the previous draft)', () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();
    const { rerender } = render(
      <CreateDesignModal
        open
        onClose={onClose}
        onCreate={onCreate}
        projectId="p-1"
        existingDesigns={[]}
      />,
    );
    fireEvent.change(screen.getByTestId('create-design-name-input'), {
      target: { value: 'Stale Draft' },
    });
    fireEvent.change(screen.getByTestId('create-design-cost-input'), {
      target: { value: '7.77' },
    });

    rerender(
      <CreateDesignModal
        open={false}
        onClose={onClose}
        onCreate={onCreate}
        projectId="p-1"
        existingDesigns={[]}
      />,
    );

    rerender(
      <CreateDesignModal
        open
        onClose={onClose}
        onCreate={onCreate}
        projectId="p-1"
        existingDesigns={[]}
      />,
    );
    const nameInput = screen.getByTestId('create-design-name-input') as HTMLInputElement;
    const costInput = screen.getByTestId('create-design-cost-input') as HTMLInputElement;
    expect(nameInput.value).toBe('Design 1');
    expect(costInput.value).toBe('4');
  });

  it('clearing the name disables Create and prevents onCreate', () => {
    const onCreate = vi.fn();
    render(
      <CreateDesignModal
        open
        onClose={() => {}}
        onCreate={onCreate}
        projectId="p-1"
        existingDesigns={[]}
      />,
    );
    const nameInput = screen.getByTestId('create-design-name-input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });
    const submit = screen.getByTestId('create-design-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
