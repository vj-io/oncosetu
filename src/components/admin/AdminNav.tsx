'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import type { NavGroup } from './groups'

const on = (pathname: string, href: string) => (href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`))

/** Two rows: the five groups, then the pages inside the open group (only when it has more than one). */
export function AdminNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname()
  const open = groups.find((g) => g.pages.some((p) => on(pathname, p.href)))
  const tab = (active: boolean) => clsx(
    'inline-flex h-11 items-center border-b-2 px-2.5 text-sm whitespace-nowrap transition-colors focus-visible:outline-offset-[-2px]',
    active ? 'border-ink text-ink' : 'border-transparent text-muted hover:border-rule hover:text-ink',
  )
  return (
    <nav aria-label="Admin sections" className="-mx-4 grid gap-0 px-4 sm:-mx-8 sm:px-8">
      <ul className="flex min-w-0 gap-1 overflow-x-auto border-b border-rule">
        <li><Link href="/admin" aria-current={pathname === '/admin' ? 'page' : undefined} className={tab(pathname === '/admin')}>Overview</Link></li>
        {groups.map((g) => (
          <li key={g.id}><Link href={g.href} aria-current={open?.id === g.id ? 'true' : undefined} className={tab(open?.id === g.id)}>{g.title}</Link></li>
        ))}
      </ul>
      {open && open.pages.length > 1 && (
        <ul aria-label={open.title} className="flex min-w-0 gap-1 overflow-x-auto border-b border-rule bg-alcove px-1">
          {open.pages.map((p) => {
            const active = on(pathname, p.href)
            return <li key={p.href}><Link href={p.href} aria-current={active ? 'page' : undefined} className={tab(active)}>{p.label}</Link></li>
          })}
        </ul>
      )}
    </nav>
  )
}
