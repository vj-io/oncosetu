'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'

export type AdminNavItem = { href: string; label: string }

/** Section switcher for the admin console. Overview matches exactly; sections match their subtree. */
export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Admin sections" className="-mx-4 overflow-x-auto border-b border-rule px-4 sm:-mx-8 sm:px-8">
      <ul className="flex min-w-max gap-1">
        {items.map((it) => {
          const active = it.href === '/admin' ? pathname === '/admin' : pathname === it.href || pathname.startsWith(`${it.href}/`)
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'inline-flex h-11 items-center border-b-2 px-2.5 text-sm whitespace-nowrap transition-colors focus-visible:outline-offset-[-2px]',
                  active ? 'border-ink text-ink' : 'border-transparent text-muted hover:border-rule hover:text-ink',
                )}
              >
                {it.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
