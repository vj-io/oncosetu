// Reads every src/app/api/**/route.ts and reports, per exported handler, the guard route() enforces (PRD §10.2
// "RBAC matrix test: every role × every endpoint"). Parsed with the TypeScript compiler, not regexes, so a reformatted
// options object still reads the same. Used by tests/security/rbac-endpoints.test.ts (static) and
// tests/e2e/rbac-sweep.spec.ts (the same table checked against a running server).
import { globSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { STAFF_ROLES, type Role } from '../../src/server/rbac'

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type SignedInRole = Exclude<Role, 'system'>
export const SIGNED_IN_ROLES: readonly SignedInRole[] = [...STAFF_ROLES, 'patient', 'caregiver']

export type ScannedRoute = {
  /** "GET /api/patients/[id]/documents" */
  key: string
  path: string
  method: (typeof METHODS)[number]
  file: string
  /** route() auth option, or 'custom' for a handler not wrapped in route() */
  auth: 'staff' | 'patient' | 'any' | 'public' | 'custom'
  /** Signed-in roles route() lets through; 'public' when it checks no session (public or custom handlers). */
  allowed: readonly SignedInRole[] | 'public'
  /** route() parses a JSON body / query / multipart form before the handler runs. */
  body: boolean
  query: boolean
  form: boolean
}

const pathOf = (file: string) =>
  '/' + file.replace(/\\/g, '/').replace(/^src\/app\//, '').replace(/\/route\.ts$/, '').split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/')

function stringArray(node: ts.Expression, consts: Map<string, ts.Expression>, file: string): string[] {
  let n: ts.Expression = node
  while (ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isParenthesizedExpression(n)) n = n.expression
  if (ts.isIdentifier(n)) {
    const v = consts.get(n.text)
    if (!v) throw new Error(`${file}: roles identifier ${n.text} is not a top-level const in this file`)
    return stringArray(v, consts, file)
  }
  if (!ts.isArrayLiteralExpression(n)) throw new Error(`${file}: roles must be an array literal`)
  return n.elements.map((e) => {
    if (!ts.isStringLiteralLike(e)) throw new Error(`${file}: roles entries must be string literals`)
    return e.text
  })
}

function readOpts(call: ts.CallExpression, consts: Map<string, ts.Expression>, file: string) {
  const arg = call.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) throw new Error(`${file}: route() options must be an object literal`)
  const prop = (name: string) => arg.properties.find((p): p is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
    (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === name)
  const authP = prop('auth')
  if (!authP || !ts.isPropertyAssignment(authP) || !ts.isStringLiteralLike(authP.initializer)) throw new Error(`${file}: route() auth must be a string literal`)
  const rolesP = prop('roles')
  const roles = rolesP ? stringArray(ts.isPropertyAssignment(rolesP) ? rolesP.initializer : rolesP.name, consts, file) : undefined
  const formP = prop('form')
  return {
    auth: authP.initializer.text as ScannedRoute['auth'],
    roles,
    body: !!prop('body'),
    query: !!prop('query'),
    form: !!formP && ts.isPropertyAssignment(formP) && formP.initializer.kind === ts.SyntaxKind.TrueKeyword,
  }
}

function effective(auth: ScannedRoute['auth'], roles: string[] | undefined): ScannedRoute['allowed'] {
  if (auth === 'public' || auth === 'custom') return 'public'
  const base: readonly SignedInRole[] = auth === 'staff' ? STAFF_ROLES : auth === 'patient' ? ['patient', 'caregiver'] : SIGNED_IN_ROLES
  return roles ? base.filter((r) => roles.includes(r)) : base
}

export function scanApiRoutes(root = process.cwd()): ScannedRoute[] {
  const out: ScannedRoute[] = []
  for (const file of globSync('src/app/api/**/route.ts', { cwd: root }).sort()) {
    const src = ts.createSourceFile(file, readFileSync(`${root}/${file}`, 'utf8'), ts.ScriptTarget.Latest, true)
    const consts = new Map<string, ts.Expression>()
    for (const st of src.statements) {
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) consts.set(d.name.text, d.initializer)
      }
    }
    const exported = (st: ts.Statement) => ts.canHaveModifiers(st) && !!ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    for (const st of src.statements) {
      if (ts.isExportDeclaration(st) || ts.isExportAssignment(st)) throw new Error(`${file}: re-exported handlers are not scanned; export route(...) directly`)
      if (!exported(st)) continue
      const add = (method: string, init: ts.Expression | undefined) => {
        if (!(METHODS as readonly string[]).includes(method)) return
        let opts: ReturnType<typeof readOpts> | { auth: 'custom'; roles: undefined; body: false; query: false; form: false }
        let e = init
        if (e && ts.isIdentifier(e)) e = consts.get(e.text) // export const POST = handler
        if (e && ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'route') opts = readOpts(e, consts, file)
        else if (!init) opts = { auth: 'custom', roles: undefined, body: false, query: false, form: false }
        else throw new Error(`${file}: ${method} is neither route(...) nor a function declaration`)
        const path = pathOf(file)
        out.push({ key: `${method} ${path}`, path, method: method as ScannedRoute['method'], file, auth: opts.auth, allowed: effective(opts.auth, opts.roles), body: opts.body, query: opts.query, form: opts.form })
      }
      if (ts.isFunctionDeclaration(st) && st.name) add(st.name.text, undefined)
      else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) add(d.name.text, d.initializer)
      }
    }
  }
  return out
}
