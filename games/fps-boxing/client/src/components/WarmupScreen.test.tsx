import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WarmupScreen } from './WarmupScreen';

describe('WarmupScreen', () => {
  it('Test 1: renders loading text when status is loading', () => {
    render(
      <WarmupScreen
        status="loading"
        error={null}
        onWarmupComplete={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading pose engine...')).toBeTruthy();
  });

  it('Test 2: renders error message when status is error', () => {
    render(
      <WarmupScreen
        status="error"
        error="WASM load failed"
        onWarmupComplete={vi.fn()}
      />,
    );
    expect(screen.getByText('WASM load failed')).toBeTruthy();
  });

  it('Test 3: calls onWarmupComplete when status is ready', () => {
    const onWarmupComplete = vi.fn();
    render(
      <WarmupScreen
        status="ready"
        error={null}
        onWarmupComplete={onWarmupComplete}
      />,
    );
    expect(onWarmupComplete).toHaveBeenCalledTimes(1);
  });

  it('Test 4: does not show loading text when status is error', () => {
    render(
      <WarmupScreen
        status="error"
        error="Some error"
        onWarmupComplete={vi.fn()}
      />,
    );
    expect(screen.queryByText('Loading pose engine...')).toBeNull();
  });
});
