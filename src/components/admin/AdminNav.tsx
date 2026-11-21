'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import type { NavGroup } from './groups'

const on = (pathname: string, href: string) => (href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`))

/** Two rows: the five groups, then the pages inside the open group (only when it has more than one). */
export function AdminNav({ groups, showOverview = true }: { groups: NavGroup[]; showOverview?: boolean }) {
  const pathname = usePathname()
  const open = groups.find((g) => g.pages.some((p) => on(pathname, p.href)))
  const tab = (active: boolean) => clsx(
    'inline-flex h-10 items-center rounded-sm px-3 text-[15px] whitespace-nowrap transition-colors',
    active ? 'bg-surface font-semibold text-ink shadow-card' : 'text-muted hover:bg-surface/60 hover:text-ink',
  )
  return (
    <nav aria-label="Admin sections" className="grid gap-2">
      <ul className="flex w-fit max-w-full min-w-0 gap-1 overflow-x-auto rounded-md bg-alcove p-1">
        {showOverview && <li><Link href="/admin" aria-current={pathname === '/admin' ? 'page' : undefined} className={tab(pathname === '/admin')}>Overview</Link></li>}
        {groups.map((g) => (
          <li key={g.id}><Link href={g.href} aria-current={open?.id === g.id ? 'true' : undefined} className={tab(open?.id === g.id)}>{g.pages.length === 1 ? g.pages[0].label : g.title}</Link></li>
        ))}
      </ul>
      {open && open.pages.length > 1 && (
        <ul aria-label={open.title} className="flex min-w-0 gap-1 overflow-x-auto px-1">
          {open.pages.map((p) => {
            const active = on(pathname, p.href)
            return <li key={p.href}><Link href={p.href} aria-current={active ? 'page' : undefined} className={tab(active)}>{p.label}</Link></li>
          })}
        </ul>
      )}
    </nav>
  )
}
