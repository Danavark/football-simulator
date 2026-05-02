import './globals.css'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'Football Match Prototype',
  description: 'Live match driver for the simulation engine'
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
