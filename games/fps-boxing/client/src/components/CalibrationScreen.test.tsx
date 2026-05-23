import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as useCalibrationModule from '@shared/client/useCalibration';
import { CalibrationScreen } from './CalibrationScreen';
import type { UseCalibrationResult } from '@shared/client/useCalibration';

const defaultCalResult: UseCalibrationResult = {
  stage: 'tpose',
  punchesRecorded: 0,
  tposeProgress: 0,
  neutralProgress: 0,
  referenceVelocity: null,
  instruction: 'Stand facing camera, arms out wide. Hold still. (0%)',
  calibrationSamples: [],
};

const mockUseCalibration = vi.spyOn(useCalibrationModule, 'useCalibration');

beforeEach(() => {
  mockUseCalibration.mockReturnValue({ ...defaultCalResult });
});

describe('CalibrationScreen', () => {
  it('Test 1: renders calibration-screen container', () => {
    const { container } = render(
      <CalibrationScreen
        keypoints={null}
        onCalibrationDone={vi.fn()}
      />,
    );
    expect(container.querySelector('.calibration-screen')).not.toBeNull();
  });

  it('Test 2: renders calibration-ui panel', () => {
    const { container } = render(
      <CalibrationScreen
        keypoints={null}
        onCalibrationDone={vi.fn()}
      />,
    );
    expect(container.querySelector('.calibration-ui')).not.toBeNull();
  });

  it('Test 3: shows instruction text from useCalibration', () => {
    mockUseCalibration.mockReturnValue({
      ...defaultCalResult,
      stage: 'tpose',
      instruction: 'Stand facing camera, arms out wide. Hold still. (0%)',
    });
    render(
      <CalibrationScreen
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
        keypoints={null}
        onCalibrationDone={vi.fn()}
      />,
    );
    expect(screen.getByText('60%')).toBeTruthy();
  });

  it('Test 5: shows punch counter during labeled punch stage', () => {
    mockUseCalibration.mockReturnValue({
      ...defaultCalResult,
      stage: 'punch_cross',
      punchesRecorded: 2,
      instruction: 'CROSS — throw your back-hand straight punch (2/4)',
    });
    render(
      <CalibrationScreen
        keypoints={null}
        onCalibrationDone={vi.fn()}
      />,
    );
    expect(screen.getByText('2/4')).toBeTruthy();
    expect(screen.getByText('CROSS')).toBeTruthy();
  });

  it('Test 6: shows full upper body visibility hint during tpose', () => {
    mockUseCalibration.mockReturnValue({
      ...defaultCalResult,
      stage: 'tpose',
    });
    render(
      <CalibrationScreen
        keypoints={null}
        onCalibrationDone={vi.fn()}
      />,
    );
    const hint = screen.getByText(/full upper body|Step back/i);
    expect(hint).toBeTruthy();
  });

  it('Test 7: calls onCalibrationDone when useCalibration calls onComplete', () => {
    const onCalibrationDone = vi.fn();
    mockUseCalibration.mockImplementation(({ onComplete }) => {
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
        keypoints={null}
        onCalibrationDone={onCalibrationDone}
      />,
    );
    expect(onCalibrationDone).toHaveBeenCalledWith(3.5);
  });
});
