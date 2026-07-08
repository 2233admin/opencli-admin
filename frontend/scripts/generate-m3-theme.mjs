/**
 * Generate Material 3 tonal palette from a seed color using Google's
 * official material-color-utilities, mapped onto shadcn token names.
 * Usage: node scripts/generate-m3-theme.mjs
 */
import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
  TonalPalette,
} from '@material/material-color-utilities'

const SEED = '#1a73e8' // Gemini blue

const theme = themeFromSourceColor(argbFromHex(SEED))
const { palettes } = theme

const tone = (palette, t) => hexFromArgb(palette.tone(t))
const p = palettes.primary
const sec = palettes.secondary
const ter = palettes.tertiary
const n = palettes.neutral
const nv = palettes.neutralVariant
const err = palettes.error

// Success/warning palettes harmonized the M3 way: keyed tonal palettes.
const green = TonalPalette.fromHueAndChroma(145, 48)
const amber = TonalPalette.fromHueAndChroma(85, 60)

const light = {
  background: tone(n, 99),
  foreground: tone(n, 10),
  card: tone(n, 98),
  'card-foreground': tone(n, 10),
  popover: tone(n, 98),
  'popover-foreground': tone(n, 10),
  primary: tone(p, 40),
  'primary-foreground': tone(p, 100),
  secondary: tone(sec, 90),
  'secondary-foreground': tone(sec, 10),
  muted: tone(nv, 95),
  'muted-foreground': tone(nv, 30),
  accent: tone(p, 92),
  'accent-foreground': tone(p, 10),
  destructive: tone(err, 40),
  'destructive-foreground': tone(err, 100),
  success: tone(green, 40),
  'success-foreground': tone(green, 100),
  warning: tone(amber, 40),
  'warning-foreground': tone(amber, 100),
  info: tone(p, 40),
  'info-foreground': tone(p, 100),
  border: tone(nv, 80),
  input: tone(nv, 80),
  ring: tone(p, 40),
  'chart-1': tone(p, 40),
  'chart-2': tone(green, 40),
  'chart-3': tone(amber, 40),
  'chart-4': tone(err, 40),
  'chart-5': tone(ter, 40),
  sidebar: tone(n, 96),
  'sidebar-foreground': tone(n, 10),
  'sidebar-primary': tone(p, 40),
  'sidebar-primary-foreground': tone(p, 100),
  'sidebar-accent': tone(p, 90),
  'sidebar-accent-foreground': tone(p, 10),
  'sidebar-border': tone(nv, 80),
  'sidebar-ring': tone(p, 40),
}

const dark = {
  background: tone(n, 6),
  foreground: tone(n, 90),
  card: tone(n, 10),
  'card-foreground': tone(n, 90),
  popover: tone(n, 12),
  'popover-foreground': tone(n, 90),
  primary: tone(p, 80),
  'primary-foreground': tone(p, 20),
  secondary: tone(sec, 30),
  'secondary-foreground': tone(sec, 90),
  muted: tone(nv, 20),
  'muted-foreground': tone(nv, 70),
  accent: tone(p, 25),
  'accent-foreground': tone(p, 90),
  destructive: tone(err, 80),
  'destructive-foreground': tone(err, 20),
  success: tone(green, 80),
  'success-foreground': tone(green, 20),
  warning: tone(amber, 80),
  'warning-foreground': tone(amber, 20),
  info: tone(p, 80),
  'info-foreground': tone(p, 20),
  border: tone(nv, 25),
  input: tone(nv, 25),
  ring: tone(p, 80),
  'chart-1': tone(p, 80),
  'chart-2': tone(green, 80),
  'chart-3': tone(amber, 80),
  'chart-4': tone(err, 80),
  'chart-5': tone(ter, 80),
  sidebar: tone(n, 4),
  'sidebar-foreground': tone(n, 90),
  'sidebar-primary': tone(p, 80),
  'sidebar-primary-foreground': tone(p, 20),
  'sidebar-accent': tone(p, 20),
  'sidebar-accent-foreground': tone(p, 90),
  'sidebar-border': tone(nv, 20),
  'sidebar-ring': tone(p, 80),
}

const fmt = (obj, indent) =>
  Object.entries(obj)
    .map(([k, v]) => `${indent}--${k}: ${v};`)
    .join('\n')

console.log(':root {')
console.log('  color-scheme: light;')
console.log(fmt(light, '  '))
console.log('  --radius: 0.75rem;')
console.log('}')
console.log('')
console.log('.dark {')
console.log('  color-scheme: dark;')
console.log(fmt(dark, '  '))
console.log('}')
