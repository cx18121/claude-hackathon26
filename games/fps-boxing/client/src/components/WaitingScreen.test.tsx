import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WaitingScreen } from './WaitingScreen';

describe('WaitingScreen', () => {
  it('shows room code', () => {
    render(<WaitingScreen roomCode="ABCD" slot={1} opponentConnected={false} />);
    expect(screen.getByText('ABCD')).toBeTruthy();
  });

  it('shows Player 1 when slot is 1', () => {
    render(<WaitingScreen roomCode="ABCD" slot={1} opponentConnected={false} />);
    expect(screen.getByText('Player 1')).toBeTruthy();
  });

  it('shows Player 2 when slot is 2', () => {
    render(<WaitingScreen roomCode="ABCD" slot={2} opponentConnected={false} />);
    expect(screen.getByText('Player 2')).toBeTruthy();
  });

  it('shows waiting message when opponentConnected is false', () => {
    render(<WaitingScreen roomCode="ABCD" slot={1} opponentConnected={false} />);
    expect(screen.getByText('Waiting for opponent...')).toBeTruthy();
  });

  it('shows connected message when opponentConnected is true', () => {
    render(<WaitingScreen roomCode="ABCD" slot={1} opponentConnected={true} />);
    expect(screen.getByText('Both players connected — starting...')).toBeTruthy();
  });

  it('renders without crashing when roomCode is empty', () => {
    const { container } = render(<WaitingScreen roomCode="" slot={1} opponentConnected={false} />);
    expect(container.querySelector('.waiting-room-code')).toBeTruthy();
  });
});
