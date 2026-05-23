import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PermissionScreen } from './PermissionScreen';

beforeEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn() },
    writable: true,
    configurable: true,
  });
});

describe('PermissionScreen', () => {
  it('Test 1: renders explanation text and CTA button', () => {
    const onGranted = vi.fn();
    render(<PermissionScreen onPermissionGranted={onGranted} />);
    expect(screen.getByText(/No video is transmitted/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Allow camera access/i })).toBeTruthy();
  });

  it('Test 2: does NOT call getUserMedia on mount; calls it on button click', async () => {
    const onGranted = vi.fn();
    const stream = {} as MediaStream;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream);

    render(<PermissionScreen onPermissionGranted={onGranted} />);

    // Not called on mount
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();

    // Called on click
    fireEvent.click(screen.getByRole('button', { name: /Allow camera access/i }));
    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    });
  });

  it('Test 3: calls onPermissionGranted with stream on success', async () => {
    const onGranted = vi.fn();
    const stream = { id: 'test-stream' } as unknown as MediaStream;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream);

    render(<PermissionScreen onPermissionGranted={onGranted} />);
    fireEvent.click(screen.getByRole('button', { name: /Allow camera access/i }));

    await waitFor(() => {
      expect(onGranted).toHaveBeenCalledWith(stream);
    });
  });

  it('Test 4: NotAllowedError shows camera permission denied message', async () => {
    const onGranted = vi.fn();
    const error = Object.assign(new DOMException('denied', 'NotAllowedError'));
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(error);

    render(<PermissionScreen onPermissionGranted={onGranted} />);
    fireEvent.click(screen.getByRole('button', { name: /Allow camera access/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Camera permission denied\. Allow access in your browser settings and reload\./i)
      ).toBeTruthy();
    });
  });

  it('Test 5: NotFoundError shows no camera detected message', async () => {
    const onGranted = vi.fn();
    const error = Object.assign(new DOMException('no device', 'NotFoundError'));
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(error);

    render(<PermissionScreen onPermissionGranted={onGranted} />);
    fireEvent.click(screen.getByRole('button', { name: /Allow camera access/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/No camera detected\. Connect a webcam and reload\./i)
      ).toBeTruthy();
    });
  });

  it('Test 6: generic DOMException shows "Could not open camera:" message', async () => {
    const onGranted = vi.fn();
    const error = new DOMException('some error', 'AbortError');
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(error);

    render(<PermissionScreen onPermissionGranted={onGranted} />);
    fireEvent.click(screen.getByRole('button', { name: /Allow camera access/i }));

    await waitFor(() => {
      expect(screen.getByText(/Could not open camera:/i)).toBeTruthy();
    });
  });

  it('Test 7: button shows "Requesting..." and is disabled while getUserMedia is in flight', async () => {
    const onGranted = vi.fn();
    let resolveStream!: (s: MediaStream) => void;
    const streamPromise = new Promise<MediaStream>((res) => { resolveStream = res; });
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(streamPromise);

    render(<PermissionScreen onPermissionGranted={onGranted} />);
    fireEvent.click(screen.getByRole('button', { name: /Allow camera access/i }));

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Requesting\.\.\./i });
      expect(btn).toBeTruthy();
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });

    // Resolve the promise
    resolveStream({} as MediaStream);
    await waitFor(() => {
      expect(onGranted).toHaveBeenCalled();
    });
  });
});
