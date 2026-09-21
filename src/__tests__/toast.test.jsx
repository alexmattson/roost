import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastProvider, useToast } from '../store/toast.jsx';

function Trigger({ kind, text, ms }) {
  const toast = useToast();
  return <button onClick={() => toast(kind, text, ms)}>fire</button>;
}

describe('toast system', () => {
  it('shows a notification over the layout and dismisses on close', () => {
    render(<ToastProvider><Trigger kind="ok" text="Saved it" ms={0} /></ToastProvider>);
    fireEvent.click(screen.getByText('fire'));
    expect(screen.getByText('Saved it')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Dismiss notification'));
    expect(screen.queryByText('Saved it')).toBeNull();
  });

  it('ignores empty messages', () => {
    render(<ToastProvider><Trigger kind="ok" text="" /></ToastProvider>);
    fireEvent.click(screen.getByText('fire'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
