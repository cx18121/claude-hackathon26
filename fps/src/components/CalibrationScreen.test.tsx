import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as useCalibrationModule from '../hooks/useCalibration';
import { CalibrationScreen } from './CalibrationScreen';
import type { UseCalibrationResult } from '../hooks/useCalibration';

const defaultCalResult: UseCalibrationResult = {
  stage: 'tpose',
  punchesRecorded: 0,
  tposeProgress: 0,
  neutralProgress: 0,
  referenceVelocity: null,
  instruction: 'Stand facing camera, arms out wide. Hold still. (0%)',
};

const mockUseCalibration = vi.spyOn(useCalibrationModule, 'useCalibration');

beforeEach(() => {
  mockUseCalibration.mockReturnValue({ ...defaultCalResult });
});

describe('CalibrationScreen', () => {
  it('Test 1: renders video element with autoPlay, playsInline, and muted attributes', () => {
    render(
      <CalibrationScreen
        stream={null}
        keypoints={null}
        onCalibrationDone={vi.fn()}
      />,
    );
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.autoplay).toBe(true);
    expect(video!.playsInline).toBe(true);
    expect(video!.muted).toBe(true);
  });

  it('Test 2: video srcObject set from stream prop', () => {
    // Create a mock MediaStream-like object
    const mockStream = { id: 'mock-stream' } as unknown as MediaStream;
    render(
      <CalibrationScreen
        stream={mockStream}
        keypoints={null}
        onCalibrationDone={vi.fn()}
      />,
    );
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.srcObject).toBe(mockStream);
  });

  it('Test 3: shows instruction text from useCalibration', () => {
    mockUseCalibration.mockReturnValue({
      ...defaultCalResult,
      stage: 'tpose',
      instruction: 'Stand facing camera, arms out wide. Hold still. (0%)',
    });
    render(
      <CalibrationScreen
        stream={null}
        keypoints={null}
        onCalibrationDone={vi.fn()}
      />,
    );
    expect(screen.getByText('Stand facing camera, arms out wide. Hold still. (0%)')).toBeTruthy();
  });

  it('Test 4: shows tpose progress % during tpose stage', () => {
    mockUseCalibration.mockReturnValue({
      ...defaultCalResult,
      stage: 'tpose',
      tposeProgress: 0.6,
    });
    render(
      <CalibrationScreen
        stream={null}
        keypoints={null}
        onCalibrationDone={vi.fn()}
      />,
    );
    expect(screen.getByText('60%')).toBeTruthy();
  });

  it('Test 5: shows punch counter during punches stage', () => {
    mockUseCalibration.mockReturnValue({
      ...defaultCalResult,
      stage: 'punches',
      punchesRecorded: 2,
      instruction: 'Throw 3 punches at full speed! (2/3)',
    });
    render(
      <CalibrationScreen
        stream={null}
        keypoints={null}
        onCalibrationDone={vi.fn()}
      />,
    );
    expect(screen.getByText('2/3')).toBeTruthy();
  });

  it('Test 6: shows full upper body visibility hint during tpose', () => {
    mockUseCalibration.mockReturnValue({
      ...defaultCalResult,
      stage: 'tpose',
    });
    render(
      <CalibrationScreen
        stream={null}
        keypoints={null}
        onCalibrationDone={vi.fn()}
      />,
    );
    // Should show the "Step back" or "full upper body" hint
    const hint = screen.getByText(/full upper body|Step back/i);
    expect(hint).toBeTruthy();
  });

  it('Test 7: calls onCalibrationDone when useCalibration calls onComplete', () => {
    // When useCalibration is called, intercept the onComplete argument
    // and immediately invoke it with a test velocity
    const onCalibrationDone = vi.fn();
    mockUseCalibration.mockImplementation(({ onComplete }) => {
      // Simulate onComplete being called synchronously during render
      onComplete(3.5);
      return {
        ...defaultCalResult,
        stage: 'done',
        referenceVelocity: 3.5,
        instruction: 'Calibrated! Get ready to fight.',
      };
    });
    render(
      <CalibrationScreen
        stream={null}
        keypoints={null}
        onCalibrationDone={onCalibrationDone}
      />,
    );
    expect(onCalibrationDone).toHaveBeenCalledWith(3.5);
  });
});
