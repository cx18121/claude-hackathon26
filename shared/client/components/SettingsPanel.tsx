import { useState } from 'react'
import { setBgmVolume, setSfxVolume, getBgmVolume, getSfxVolume } from '../lib/sfx'

interface AudioSettings {
  bgm: number
  sfx: number
  commentary: number
  commentaryOn: boolean
}

interface SettingsPanelProps {
  settings: AudioSettings
  onChange: (s: AudioSettings) => void
}

export type { AudioSettings }

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  bgm: getBgmVolume(),
  sfx: getSfxVolume(),
  commentary: 1.0,
  commentaryOn: true,
}

function VolumeRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <label className={`settings-row${disabled ? ' settings-row-disabled' : ''}`}>
      <span className="settings-label">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="settings-slider"
      />
      <span className="settings-value">{Math.round(value * 100)}</span>
    </label>
  )
}

export function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  const [open, setOpen] = useState(false)

  function update(patch: Partial<AudioSettings>) {
    const next = { ...settings, ...patch }
    if ('bgm' in patch) setBgmVolume(next.bgm)
    if ('sfx' in patch) setSfxVolume(next.sfx)
    onChange(next)
  }

  return (
    <div className="settings-anchor">
      <button
        className="settings-toggle"
        onClick={() => setOpen(o => !o)}
        aria-label="Audio settings"
        title="Audio settings"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
          <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="settings-panel">
          <div className="settings-header">Audio</div>

          <VolumeRow
            label="Music"
            value={settings.bgm}
            onChange={bgm => update({ bgm })}
          />
          <VolumeRow
            label="Effects"
            value={settings.sfx}
            onChange={sfx => update({ sfx })}
          />

          <div className="settings-divider" />

          <label className="settings-row settings-row-toggle">
            <span className="settings-label">Commentary</span>
            <button
              className={`settings-toggle-btn${settings.commentaryOn ? ' on' : ''}`}
              onClick={() => update({ commentaryOn: !settings.commentaryOn })}
            >
              {settings.commentaryOn ? 'ON' : 'OFF'}
            </button>
          </label>

          <VolumeRow
            label="Volume"
            value={settings.commentary}
            onChange={commentary => update({ commentary })}
            disabled={!settings.commentaryOn}
          />
        </div>
      )}
    </div>
  )
}
