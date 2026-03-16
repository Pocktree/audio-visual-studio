import { useState, useEffect } from 'react'

const defaultSettings = {
  defaultFontStack: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  },
  testText: 'The quick brown fox jumps over the lazy dog. 0123456789 色彩与文字 Aa',
  testColors: ['#e03c31', '#f2a900', '#7fb339', '#00a4a6', '#5b5ea6', '#9b59b6'],
  autoSwitchIntervalMs: 5000,
}

export function useSettings() {
  const [settings, setSettings] = useState(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let done = false
    const finish = () => {
      if (!done) {
        done = true
        setLoading(false)
      }
    }
    const t = setTimeout(finish, 2000)

    fetch('/settings.json')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load settings')
        return res.json()
      })
      .then((data) => {
        if (!done) {
          setSettings((prev) => ({
            ...defaultSettings,
            ...prev,
            ...data,
            defaultFontStack: { ...defaultSettings.defaultFontStack, ...(data.defaultFontStack || {}) },
          }))
        }
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(t)
        finish()
      })
  }, [])

  return { settings, loading, error }
}
