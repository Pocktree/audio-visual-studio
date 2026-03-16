# Audio Visual Studio

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

---

Real-time visual effects testing platform built with React + Framer Motion. Designed for display testing, motion blur analysis, typography animation, and audio visualization.

---

## Design Overview

The project is a **modular visual testing framework** that cycles through different visual effect modules. Each module focuses on specific testing or demonstration purposes:

- **GRID** — Display testing (color, uniformity, BFI, white balance)
- **BIG** — Typography & wave animation
- **SCROLL** — Motion blur & scrolling smoothness testing
- **RAIN** — Particle simulation
- **AUDIO-VISUAL** — Audio-reactive visualization

All modules can be controlled via keyboard shortcuts or the on-screen control panel.

---

## Global Controls

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `P` | Toggle auto-play (cycle through modules) |
| `Space` | Switch to next module |
| `F` | Toggle fullscreen |

### Navigation Bar
Appears at the bottom when hovering the mouse near the bottom edge. Shows current module name and auto/paused status.

---

## Modules

### 1. GRID

A dynamic color grid module designed for **display testing**.

#### Features
| Feature | Description |
|---------|-------------|
| Auto-cycle | Randomly changes grid size (1×1 to N×N) every 5 seconds |
| Color Space | Switch between Display-P3 and sRGB gamuts |
| BFI Test | Black Frame Insertion for motion blur reduction testing |
| COLOR OFFSET | White balance calibration with R/G/B offset adjustment |
| Uniformity Test | 7 gray level patterns for panel uniformity verification |
| Bitdepth Test | Gradient visualization for bitdepth/dither analysis |

#### Shortcuts
| Key | Action |
|-----|--------|
| `[` / `]` | Switch calibration level (Low/Mid/High) |
| `↑` / `↓` | Adjust R/G/B offset value (±1) |
| `1` - `7` | Trigger uniformity test patterns |
| `D` | Toggle bitdepth test mode |

---

### 2. BIG

Full-window **kinetic typography** with wave effects.

#### Features
| Feature | Description |
|---------|-------------|
| Random Letter | Displays random uppercase letters with rotation |
| Wave Effect | Sinusoidal wave animation across the viewport |
| Inverted Mode | Invert colors |
| Outline Mode | Text outline effect |
| Font Weight | Adjustable font weight (100-900) |
| Overscan Ruler | Geometry畸变与边框校准标尺 |

#### Shortcuts
| Key | Action |
|-----|--------|
| `7` | Decrease wave amplitude |
| `8` | Increase wave amplitude |
| `9` | Decrease wave frequency |
| `0` | Increase wave frequency |

---

### 3. SCROLL

Smooth **scrolling text animation** for motion blur testing.

#### Features
| Feature | Description |
|---------|-------------|
| Scroll Animation | Continuous horizontal scrolling text |
| Inverted Mode | Invert colors |
| Color Mode | Switch between B&W and random color |
| Wavy Edge | Toggle wavy edge effect |
| Pursuit Mode | Simulated camera pursuit for GTG (Gray-to-Gray) response time testing |

#### Shortcuts (when Pursuit Mode is active)
| Key | Action |
|-----|--------|
| `[` / `]` | Adjust scroll speed (480/960/1440 Hz) |
| `+` / `-` | Adjust pursuit scale |
| `←` / `→` | Adjust virtual shadow length |

---

### 4. RAIN

**Rain drop particle simulation** effect.

#### Features
| Feature | Description |
|---------|-------------|
| Particle System | Physics-based rain drop simulation |
| Speed Control | Adjust rain fall speed |
| Density Control | Adjust number of rain drops |
| Grid Overlay | Display reference grid |
| Labels | Show speed/density labels |
| Light Mode | Switch to light background |
| Color Scheme | Default or water-blue theme |

#### Shortcuts
| Key | Action |
|-----|--------|
| `+` | Increase density by 500 (stress test) |
| `-` | Decrease density by 500 (min 10) |

---

### 5. AUDIO-VISUAL

**Audio-reactive typography** with fluid shader visualization.

#### Features
| Feature | Description |
|---------|-------------|
| Fluid Shader | Real-time fluid simulation visualization |
| Audio React | Typography responds to audio input |
| Color Test | SMPTE color bars, grayscale, or fluid mode |
| Font Weight | Adjustable typography weight |
| Tracking | Adjust letter spacing |
| Invert Colors | Toggle color inversion |
| Glitch Effect | Random glitch/jitter effect |
| Live Timer | Real-time elapsed time display |

#### Shortcuts
*None*

---

## Installation

```bash
npm install
npm run dev
```

## Tech Stack

React 19 · Framer Motion · Tailwind CSS · Vite
